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

### Student career tools

**School not listed.** At sign-up a student can tick "My school isn't on the list" and type their
school and program. These are stored as plain text on the account (`User.schoolName/programName`),
not as new School rows, so typos never reach career-office analytics. A typed name matching a
listed school is refused with a pointer to the list. These students have no course-mapped skills;
certificates, projects, self-declared skills and the resume still work. Admins see the typed
schools, most students first, on Program insights (`GET /api/schools/unlisted`): who to onboard.

**Check a job link** (`POST /api/me/job-check`, `src/services/jobLinkService.js`). The student
pastes a link (or the description). The page is read once on their behalf: SSRF-guarded, with
redirects followed by hand and every hop re-checked. schema.org `JobPosting` data is used when
the site publishes it (most career sites do, for Google for Jobs); otherwise the page text, which
the AI may trim to the job (copy only, checked with `groundedShare`). The result: match status,
**"your best evidence"** (which course, certificate or project proves each matched skill), what is
missing, free courses, and an optional AI cover letter written only from the student's real
profile (`POST /api/me/cover-letter`). Nothing is stored. Sites behind a login (LinkedIn, Indeed,
Facebook) usually refuse; the student is told to paste the description instead.

**Resume maker** (`GET/POST /api/me/resume`, `src/services/resumeService.js`). The student chooses
which skills appear: nothing is copied automatically. Profile skills are offered as one-click
suggestions (or "add all"), and any skill can be typed; known names are matched to the taxonomy
("ms excel" becomes Microsoft Excel, grouped under Office), unknown ones are kept under "Other".
Certificates and projects (optional) come from the profile; the student adds contact, target
role, experience and education (each with a location), plus any other projects (title, tools,
description) and certificates (name, issuer, date) by hand, printed after the profile ones
without repeats. The printed resume uses the classic
one-column format recruiters and ATS read best: serif type, ruled section titles in the order
Professional Summary, Work Experience, Projects, Education, Certifications & Skills, with the
name and date on one bold line and the role and location in italics below. Empty sections are
left out.

**Skills SkillBridge does not know.** On My skills, a search with no exact match offers "Add
'Canva' as my own skill". A name that matches a known skill or alias ("ms excel") adds the real
skill instead. Unknown names are kept as `CustomSkill` rows, apart from the taxonomy so typos never
reach extraction or analytics. They show on the profile and as resume suggestions, but job
matching cannot use them until an admin adds them: the Skills taxonomy page lists what students
typed, most students first (`GET /api/skills/requested`), and adding the skill, or an alias with
that spelling, converts every student's custom copy into the real skill. The AI only improves wording: every bullet and the summary are checked against the
facts given, and anything that adds content (a new employer, tool or number) is replaced with the
student's own sentence. Without a working AI the template version is used. After building, it
suggests **where to apply**: READY jobs and CLOSE jobs with at least 50% (the target role first),
best-fit occupations, and skills the resume mentions that are not on the profile yet. Printing
gives a clean one-page document (print CSS hides the app).

**AI mock interview** (`/api/me/interviews`, `src/services/interviewService.js`). From any job a
student matches at least 30% (Job matches, Job alerts, Check a job link), an AI interviewer acting
as an experienced HR recruiter runs a practice interview with questions written from that job's
own description. The match sets the interview: 30-49% *stretch practice* (5 questions:
transferable skills, closing gaps), 50-99% *close match* (6: matched skills in depth, a STAR
question, a missing-skill question), 100% *full interview* (7, final-round bar).
- One question at a time, at most one follow-up per question. The **server** runs the flow (next
  question, follow-up limit, end); the AI only writes the words, and every AI reply is validated.
  A reaction line that contains a question is trimmed, so the student never gets two at once.
- Scores stay hidden until the end. The report gives a verdict, a 1-5 score per answer, strengths,
  improvements, a "stronger answer" tip per question and next steps. Questions not reached (ended
  early) are marked, never judged. If the AI cannot write the report, one is built from the notes
  taken after each answer, so the student always gets feedback.
- Answers are treated as data: an answer that tries to instruct the interviewer is just a weak
  answer. Conditional updates stop a double-submitted answer. Rate-limited (10 starts, 120 answers
  per hour); sessions are saved per student for review and deleted with the account.

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
