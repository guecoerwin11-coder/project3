import express from 'express'
import {
    importJobs, listImports, listSources, createSource, updateSource, runJobSource, reextract,
    aiIntake, getReviews, publishPostingReview, rejectPostingReview,
    listJobs, getJob, getProgramInsights, getMarket
} from '../controllers/jobController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'
import rateLimit from '../middleware/rateLimit.js'

const jobRouter = express.Router()
const admin = [validation, isAuthorize('ADMIN')]

/**
 * @openapi
 * tags:
 *   - name: Ingestion
 *     description: Getting job postings in (ADMIN)
 *   - name: Jobs
 *     description: Browsing postings
 *   - name: Insights
 *     description: Market demand and school program analytics
 */

/**
 * @openapi
 * /jobs/import:
 *   post:
 *     summary: Import postings from JSON or CSV (job fair lists, partner employers)
 *     description: |
 *       Every item goes through normalize -> dedupe -> extract skills -> classify occupation.
 *       Re-importing is safe: identical postings count as duplicates; a known externalId with
 *       changed content is updated. Fields: title, company, description (required), location,
 *       url, postedAt, externalId.
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source, data]
 *             properties:
 *               source: { type: string, example: peso-jobfair-2026-10 }
 *               format: { type: string, enum: [json, csv], default: json }
 *               data:
 *                 description: Array of postings (json) or CSV text with a header row (csv)
 *     responses:
 *       201: { description: The import run with counts and per-item errors }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
jobRouter.post('/jobs/import', ...admin, importJobs)

/**
 * @openapi
 * /jobs/imports:
 *   get:
 *     summary: Recent import runs (audit log)
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Import runs }
 * /jobs/reextract:
 *   post:
 *     summary: Re-run skill extraction on every posting after the taxonomy changed
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Number of postings processed }
 */
jobRouter.get('/jobs/imports', ...admin, listImports)
jobRouter.post('/jobs/reextract', ...admin, reextract)

/**
 * @openapi
 * /jobs/ai-intake:
 *   post:
 *     summary: Read pasted hiring posts with AI; publish clean ones, queue flagged ones
 *     description: |
 *       Paste Facebook hiring posts, emails, PESO announcements or PDF text (up to 20,000
 *       characters). The AI reads each job opening into title, company, location, description
 *       and url, then the normal pipeline extracts skills, so student matches update.
 *       A posting is held for review when the AI or the built-in rules see a red flag
 *       (fees, OTP/bank details, e-wallet payment, unrealistic pay, overseas without license),
 *       when its description differs from the pasted text, or when a required field is missing.
 *       Needs AI_API_KEY, AI_BASE_URL and AI_MODEL. 20 runs per admin per hour.
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 20000 }
 *               source: { type: string, default: ai-intake, example: fb-hiring-posts }
 *     responses:
 *       201: { description: "{ found, run, published, flagged }" }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       503: { description: AI not configured or provider unavailable }
 * /job-reviews:
 *   get:
 *     summary: Postings the AI held back for review
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, PUBLISHED, REJECTED], default: PENDING } }
 *     responses:
 *       200: { description: Reviews }
 * /job-reviews/{id}/publish:
 *   post:
 *     summary: Publish a held posting, optionally correcting its fields first
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               company: { type: string }
 *               location: { type: string }
 *               description: { type: string }
 *               url: { type: string }
 *     responses:
 *       200: { description: The review, now PUBLISHED }
 *       409: { description: Already published or rejected }
 * /job-reviews/{id}/reject:
 *   post:
 *     summary: Reject a held posting
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The review, now REJECTED }
 */
jobRouter.post('/jobs/ai-intake', ...admin, rateLimit({ max: 20, windowMs: 60 * 60 * 1000 }), aiIntake)
jobRouter.get('/job-reviews', ...admin, getReviews)
jobRouter.post('/job-reviews/:id/publish', ...admin, publishPostingReview)
jobRouter.post('/job-reviews/:id/reject', ...admin, rejectPostingReview)

/**
 * @openapi
 * /job-sources:
 *   get:
 *     summary: Automatic sources, their schedule and last result, plus the available source types
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sources }
 *   post:
 *     summary: Add an automatic source; the scheduler pulls it on its interval
 *     description: |
 *       JSON_FEED: a partner's feed (public http(s) only; private addresses are refused).
 *       REMOTIVE: remote jobs open to the Philippines; at most every 6 hours, credited and delayed 24 h per its terms.
 *       JOOBLE: needs JOOBLE_API_KEY in .env; params { keywords: [...], location }.
 *       Postings that trip the scam rules are held in the review queue instead of being published.
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: partner-acme }
 *               type: { type: string, enum: [JSON_FEED, REMOTIVE, JOOBLE], default: JSON_FEED }
 *               url: { type: string, example: "https://careers.example.com/api/jobs.json" }
 *               itemsPath: { type: string, example: data.jobs }
 *               fieldMap: { type: object, example: { externalId: id, title: job_title, company: employer.name, description: body } }
 *               params: { type: object, example: { keywords: [web developer, data analyst], location: Philippines } }
 *               intervalMinutes: { type: integer, example: 360, description: Raised to the source's minimum }
 *     responses:
 *       201: { description: Created }
 * /job-sources/{id}:
 *   patch:
 *     summary: Pause/resume a source, or change its interval or options
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               intervalMinutes: { type: integer }
 *               params: { type: object }
 *     responses:
 *       200: { description: Updated }
 * /job-sources/{id}/run:
 *   post:
 *     summary: Pull the source now (counts towards its rate limit)
 *     tags: [Ingestion]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Run summary (fetched, created, duplicates, heldForReview...) }
 */
jobRouter.get('/job-sources', ...admin, listSources)
jobRouter.post('/job-sources', ...admin, createSource)
jobRouter.patch('/job-sources/:id', ...admin, updateSource)
jobRouter.post('/job-sources/:id/run', ...admin, runJobSource)

/**
 * @openapi
 * /jobs:
 *   get:
 *     summary: Browse postings with their extracted skills
 *     tags: [Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: occupationId, schema: { type: string } }
 *       - { in: query, name: q, schema: { type: string }, description: Search title or company }
 *       - { in: query, name: limit, schema: { type: integer, default: 30 } }
 *     responses:
 *       200: { description: Postings }
 * /jobs/{id}:
 *   get:
 *     summary: One posting with its full description and skills
 *     tags: [Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Posting }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
jobRouter.get('/jobs', validation, listJobs)
jobRouter.get('/jobs/:id', validation, getJob)

/**
 * @openapi
 * /market/skills:
 *   get:
 *     summary: Most demanded skills, overall or for one occupation
 *     tags: [Insights]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: occupationId, schema: { type: string } }
 *       - { in: query, name: days, schema: { type: integer, default: 180 } }
 *     responses:
 *       200: { description: Skill demand }
 * /programs/{id}/insights:
 *   get:
 *     summary: Curriculum vs market for a program, and how ready its students are (SCHOOL_ADMIN of that school, or ADMIN)
 *     tags: [Insights]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Program insights }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
jobRouter.get('/market/skills', validation, getMarket)
jobRouter.get('/programs/:id/insights', validation, isAuthorize('SCHOOL_ADMIN', 'ADMIN'), getProgramInsights)

export default jobRouter
