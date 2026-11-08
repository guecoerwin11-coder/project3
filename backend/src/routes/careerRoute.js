import express from 'express'
import {
    checkJob, coverLetter, showResume, saveResume,
    startMockInterview, listMockInterviews, showMockInterview, answerMockInterview, finishMockInterview, deleteMockInterview
} from '../controllers/careerController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'
import rateLimit from '../middleware/rateLimit.js'

const careerRouter = express.Router()
const student = [validation, isAuthorize('STUDENT')]
const HOUR = 60 * 60 * 1000

/**
 * @openapi
 * tags:
 *   - name: Career tools
 *     description: Check a job link against your skills, cover letters, AI resume maker
 */

/**
 * @openapi
 * /me/job-check:
 *   post:
 *     summary: Read one job (link or pasted text) and compare it with my skills
 *     description: |
 *       A link is read on the student's behalf (SSRF-guarded, redirects re-checked). Pages with
 *       schema.org JobPosting data give the cleanest result; other pages are read as text. Sites
 *       that need a login (LinkedIn, Indeed...) usually refuse, so the description can be pasted
 *       instead. Nothing is stored. 30 checks per hour.
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, example: "https://careers.example.com/jobs/123" }
 *               text: { type: string, description: Pasted job description, used when there is no url }
 *               title: { type: string }
 *               company: { type: string }
 *     responses:
 *       200: { description: "posting, match (score, status, matched/missing), evidence (where each skill comes from), resources" }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       429: { description: Rate limit reached }
 */
careerRouter.post('/me/job-check', ...student, rateLimit({ max: 30, windowMs: HOUR }), checkJob)

/**
 * @openapi
 * /me/cover-letter:
 *   post:
 *     summary: AI cover letter for one job, written only from my real profile (20 per hour)
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [posting]
 *             properties:
 *               posting: { type: object, properties: { title: { type: string }, company: { type: string }, description: { type: string } } }
 *     responses:
 *       200: { description: "{ letter }" }
 *       503: { description: AI not configured or unavailable }
 */
careerRouter.post('/me/cover-letter', ...student, rateLimit({ max: 20, windowMs: HOUR }), coverLetter)

/**
 * @openapi
 * /me/resume:
 *   get:
 *     summary: My saved resume (or a starting point from my profile) and where to apply
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "input, content, generatedBy, suggestions { jobs, occupations, skillsToAdd }" }
 *   post:
 *     summary: Build and save my resume, then suggest the best jobs to apply to (20 per hour)
 *     description: |
 *       Certificates and projects come from the profile; more of both can be typed in. With AI configured the wording
 *       is polished, and every AI sentence is checked against the facts given; anything that adds
 *       new content is replaced by the student's own sentence. Without AI a template is used.
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [input]
 *             properties:
 *               input:
 *                 type: object
 *                 properties:
 *                   contact: { type: object, properties: { fullName: { type: string }, email: { type: string }, phone: { type: string }, location: { type: string }, link: { type: string } } }
 *                   targetRole: { type: string, example: Junior Web Developer }
 *                   about: { type: string }
 *                   education: { type: array, items: { type: object } }
 *                   experience: { type: array, items: { type: object, properties: { role: { type: string }, organization: { type: string }, dates: { type: string }, description: { type: string } } } }
 *                   projects: { type: array, maxItems: 6, description: "Typed projects, printed after the profile ones; tools is comma-separated", items: { type: object, required: [title], properties: { title: { type: string }, tools: { type: string, example: "React, Firebase" }, description: { type: string } } } }
 *                   certifications: { type: array, maxItems: 10, description: Typed certificates, printed after the ones on the profile, items: { type: object, required: [name], properties: { name: { type: string }, issuer: { type: string }, date: { type: string } } } }
 *                   includeProjects: { type: boolean, default: true }
 *     responses:
 *       200: { description: The resume and suggestions }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
careerRouter.get('/me/resume', ...student, showResume)
careerRouter.post('/me/resume', ...student, rateLimit({ max: 20, windowMs: HOUR }), saveResume)

/**
 * @openapi
 * /me/interviews:
 *   get:
 *     summary: My mock interviews, newest first
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ data: [{ id, job, score, focus, status, overall, verdict }] }" }
 *   post:
 *     summary: Start an AI mock interview for a job I match at least 30%
 *     description: |
 *       An HR-style interviewer writes questions from the job's own description. The match decides
 *       the interview: 30-49% stretch practice (5 questions: transferable skills, closing gaps),
 *       50-99% close match (6: matched skills in depth, one STAR question, one missing-skill question),
 *       100% full interview (7, final-round bar). Below 30% is refused with a pointer to the gap report.
 *       Needs the AI to be configured. 10 per hour.
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jobId: { type: string, description: A stored posting (from matches or alerts) }
 *               posting: { type: object, description: "Or a job from Check a job link: { title, company, description, url }" }
 *     responses:
 *       201: { description: The session with the interviewer's first question }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       503: { description: AI not configured or unavailable }
 * /me/interviews/{id}:
 *   get:
 *     summary: One interview (transcript, and the report when finished)
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The session }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete one of my interviews
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 * /me/interviews/{id}/answer:
 *   post:
 *     summary: Answer the current question; get a follow-up, the next question, or the final report
 *     description: Scores stay hidden until the report. At most one follow-up per question. 120 per hour.
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [answer], properties: { answer: { type: string, maxLength: 2000 } } }
 *     responses:
 *       200: { description: The updated session }
 *       409: { $ref: '#/components/responses/Conflict' }
 * /me/interviews/{id}/finish:
 *   post:
 *     summary: End now and get the feedback report (unanswered questions are not scored)
 *     tags: [Career tools]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "The session with its report: overall 1-5, verdict, strengths, improvements, per-question feedback and tips, next steps" }
 */
careerRouter.get('/me/interviews', ...student, listMockInterviews)
careerRouter.post('/me/interviews', ...student, rateLimit({ max: 10, windowMs: HOUR }), startMockInterview)
careerRouter.get('/me/interviews/:id', ...student, showMockInterview)
careerRouter.delete('/me/interviews/:id', ...student, deleteMockInterview)
careerRouter.post('/me/interviews/:id/answer', ...student, rateLimit({ max: 120, windowMs: HOUR }), answerMockInterview)
careerRouter.post('/me/interviews/:id/finish', ...student, rateLimit({ max: 20, windowMs: HOUR }), finishMockInterview)

export default careerRouter
