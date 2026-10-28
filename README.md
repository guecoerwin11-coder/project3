# SkillBridge

Closes the gap between what graduates can do and what employers ask for.

- **Students** see how close they are to real job postings, which single skill would unlock the
  most jobs, and free courses that cover their gaps.
- **Schools** see which in-demand skills their curriculum does not teach, and how ready their
  students are.
- **Admins** feed in job postings (job fairs, partner employers, JSON feeds) and grow the skills
  taxonomy.

> Why: at DOLE's January 2025 job fairs only 3,364 of 25,876 job seekers were hired, and CHED
> describes the problem as a skills mismatch rather than a lack of jobs.

## Run it

Requirements: Node 20+, PostgreSQL.

```bash
cd backend
cp .env.example .env        # set DATABASE_URL and JWT_PASS
npm install
npm run db:migrate          # creates the database and tables
npm run db:seed             # demo data (WIPES SkillBridge tables)
npm run dev                 # http://localhost:4100
```

- App: http://localhost:4100
- API docs (Swagger): http://localhost:4100/api-docs
- Tests: `npm test`

Demo accounts (password `skillbridge123`):

| Email | Role | Notes |
|---|---|---|
| ana@student.local | Student, PSI BSIT | Strong web profile (courses + project) |
| franco@student.local | Student, PSI BSIT | Courses only: a typical gap report |
| kevin@student.local | Student, PSI BSBA-MM | Has Contact Center Services NC II |
| career@psi.edu.local | Career office | Pamantasan ng San Isidro |
| career@sipc.edu.local | Career office | San Isidro Polytechnic College (older BSIT curriculum) |
| admin@skillbridge.local | Platform admin | Ingestion and taxonomy |

Schools, companies and people in the seed are fictional. Learning resources point to real free
providers' home pages; curate specific course links before real use.

## How it works

```
 Sources                 Ingestion pipeline                         Analytics
 ───────                 ──────────────────                         ─────────
 CSV / JSON upload  ─┐   normalize (strip HTML, validate)           student matches (READY / CLOSE / STRETCH)
 JSON feeds         ─┼─▶ dedupe (content hash, source+externalId) ─▶ gap report + "learn next" + resources
 (SSRF-guarded)     ─┘   extract skills (taxonomy + aliases)         program coverage vs market
                         classify occupation (title keywords)        market demand
                         log ImportRun
```

### AI career assistant (optional)

Students get an **AI assistant** tab that answers questions like "What should I learn next?" or
"Which jobs can I apply to now?". It works with any OpenAI-compatible provider (NaraRouter,
OpenRouter, OpenAI...). Set these in `backend/.env` and restart:

```bash
AI_API_KEY=your-key            # stays on the server, never sent to the browser
AI_BASE_URL=https://...../v1   # the provider's OpenAI-compatible base URL
AI_MODEL=model-name            # a model from your provider that supports tool calling
```

Without `AI_API_KEY` the tab says the assistant is not set up, and nothing else changes.

- **Grounded in the matching engine.** The model gets tools (`src/services/assistantService.js`)
  that run the same analytics as the Gap report, Job matches and Job market pages, always for the
  logged-in student. It quotes numbers from them instead of inventing them.
- **Read-only.** It cannot change a profile; it points the student to the page that does.
- **Stateless and limited.** The browser sends the conversation (last 20 messages, 2,000
  characters each); 30 questions per student per hour; provider errors are never shown to users.

### AI intake of pasted hiring posts (admins)

On the Ingestion page, admins paste Facebook "We're hiring!" posts, emails, PESO announcements
or PDF text. The AI (`src/services/aiIntakeService.js`) splits them into postings with title,
company, location, description and link, then they go through the normal pipeline, so skills
are extracted the usual way and **student matches update automatically**.

- **Clean postings are published at once.** A posting is held in **Needs review** when the AI or
  the built-in rules (`src/services/postingRisk.js`, no AI) find a red flag: fees, OTP/bank
  details, e-wallet payments, unrealistic daily/weekly pay, overseas jobs (check DMW license).
- **The AI copies, it does not write.** If under 80% of a description's words appear in the pasted
  text, the posting is held, because invented requirements would distort matching.
- A held posting can be corrected (e.g. a missing company) and published, or rejected.

### Automatic job sources and real-time alerts

Jobs from other sites arrive on their own, and students hear about good matches immediately.

```
 scheduler (every minute, one instance at a time via a Postgres advisory lock)
   └─ due source? ─▶ adapter fetch ─▶ scam rules ─▶ clean: ingest   ─▶ notifier ─▶ SSE ─▶ student's browser
                                                  └▶ flagged: Needs review          └▶ Job alerts page (when offline)
```

| Source | Access | Limits SkillBridge enforces |
|---|---|---|
| **Remotive** (remote jobs) | Free, no key | Only jobs open to the Philippines (Worldwide/APAC/Asia); at most every 6 h (4/day, manual pulls included); shown 24 h after publication; "via Remotive" link on every job |
| **Jooble** (job search engine) | Free key on request: set `JOOBLE_API_KEY` | Every 60 min at most; keyword searches per source. The adapter follows Jooble's published samples; verify fields once you have a key |
| **Partner JSON feed** | The partner's permission | Every 15 min at most; SSRF-guarded |
| LinkedIn, Indeed, JobStreet | **Not supported**: their terms forbid scraping, and Indeed's public API is closed | — |

- **Same scam screen as AI intake.** Feed postings that trip `postingRisk.js` go to *Needs review*
  instead of students. For remote-only sources the overseas-deployment rule is skipped (working
  from home involves no deployment); every other rule still applies.
- **Alerts** (`src/services/notifier.js`): when a posting becomes visible, every student it is a
  READY match for, or a CLOSE match with at least 50%, gets one alert. It works off
  `JobPosting.notifiedAt`, so each posting alerts once whichever way it arrived (upload, AI intake,
  review, feed), and delayed Remotive jobs alert when their 24 h ends. Postings published more than
  30 days ago alert nobody.
- **Live delivery** (`src/services/realtime.js`) uses Server-Sent Events. The browser trades its
  JWT for a single-use 60-second ticket, so the token never appears in a URL or log. Students see a
  badge and a toast; admins see a live activity feed of source runs and alerts sent. The browser
  reconnects by itself (1 s → 30 s backoff).
- **Scaling note:** live connections live in one process. With several web instances, set
  `SCHEDULER=off` on all but one and add a pub/sub (Postgres LISTEN/NOTIFY or Redis) so every
  instance can push to its own connections.
- **Remotive's terms also forbid using their jobs to collect sign-ups.** SkillBridge requires an
  account, so confirm your use with Remotive (hello@remotive.com) before going public, or show
  their jobs on a page that needs no login.

### Key design decisions

1. **No scraping of job boards.** Scraping JobStreet, Indeed or LinkedIn breaks their terms of
   service and fails whenever their HTML changes. Postings come in through adapters (CSV/JSON
   upload, configured JSON feeds), all sharing one pipeline. A new permitted source is a field
   map, not new code.
2. **Taxonomy-based extraction** (`src/services/skillExtractor.js`). Each skill has aliases
   ("MS Excel", "spreadsheets"). Matching respects word boundaries and symbols (Java ≠ JavaScript;
   C#, C++, Node.js, .NET work), longest term first (React Native is not also React), and ignores
   single letters. Section headers and phrases ("Preferred qualifications", "is a plus") decide
   REQUIRED vs PREFERRED; About-us and Benefits sections are skipped.
3. **Skill hierarchy.** A skill counts towards its parent: MySQL satisfies a posting asking for
   SQL, React satisfies JavaScript, Excel satisfies "MS Office". Not the other way round.
4. **Scoring** (`src/services/matching.js`). Required skills weigh double. READY = no required
   skill missing; CLOSE = 1–2 missing; STRETCH = more. Postings with too little extracted (fewer
   than 2 skills, or no required skill) are not judged, so a vague posting can't show as a
   "100% match".
5. **"Learn next".** For each missing skill, the engine simulates learning it (plus its parents)
   and counts postings that move to READY, so the advice is "learn React: +4 postings ready", not
   a generic list.
6. **Demand-weighted readiness.** Readiness and curriculum coverage weight each skill by the share
   of postings asking for it (preferred counts half), ignoring skills under 15% of postings.
7. **Resource recommendations use greedy set cover**, so students get a short list that covers
   their biggest gaps without three courses teaching the same thing.
8. **Idempotent ingestion.** The content hash ignores case, spacing, source and date, so the same
   job posted through two channels is stored once. A known `source + externalId` with changed
   text is updated and re-extracted. Each run is logged with per-item errors.
9. **SSRF protection on feeds.** Only public http(s) hosts; private, loopback and cloud-metadata
   addresses are refused after DNS resolution; redirects are refused; 15 s timeout and 5 MB cap.
10. **Roles.** Students self-register into a program; career offices see only their own school;
    ingestion and taxonomy are admin-only.

## Project layout

```
backend/
  prisma/schema.prisma        Skill (+aliases, parent), Occupation, School, Program, Course,
                              Certification, User, StudentSkill (with evidence), JobPosting,
                              JobSkill, JobSource, ImportRun, LearningResource
  prisma/seed.js              demo data; postings go through the real ingestion pipeline
  src/services/
    skillExtractor.js         text -> skills, required vs preferred        (pure, tested)
    matching.js               scoring, ranking, learn-next, coverage, set cover (pure, tested)
    postingNormalizer.js      CSV parser, HTML strip, hashing, classifier  (pure, tested)
    ingestionService.js       the pipeline, feeds, re-extraction
    insightService.js         student, program and market analytics
  src/utils/safeFetch.js      SSRF-guarded feed fetching
  tests/                      Jest + Supertest (Prisma mocked)
frontend/                     plain JS single-page app, no build step
```

## Next steps

- Let career offices edit course-to-skill mappings in the app
- Trend lines: skill demand month by month
- Optional LLM-assisted extraction for skills not yet in the taxonomy, with admin review before
  they are added
- Employer accounts that post jobs directly
- Verified certificates (issuer confirmation) weighted above self-declared skills
