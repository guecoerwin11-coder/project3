import express from 'express'
import { checkJob, coverLetter, showResume, saveResume } from '../controllers/careerController.js'
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
 *       Skills, certificates and projects come from the profile. With AI configured the wording
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
 *                   includeProjects: { type: boolean, default: true }
 *     responses:
 *       200: { description: The resume and suggestions }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
careerRouter.get('/me/resume', ...student, showResume)
careerRouter.post('/me/resume', ...student, rateLimit({ max: 20, windowMs: HOUR }), saveResume)

export default careerRouter
