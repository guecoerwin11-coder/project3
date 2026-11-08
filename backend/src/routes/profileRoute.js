import express from 'express'
import {
    getMySkills, addSelfSkill, addCustomSkill, deleteCustomSkill, deleteSkill, deleteEvidence, addCourses, addCertification,
    extractProjectSkills, saveProject, getMatches, getGapReport
} from '../controllers/profileController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'

const profileRouter = express.Router()
const student = [validation, isAuthorize('STUDENT')]

/**
 * @openapi
 * tags:
 *   - name: Student
 *     description: A student's skills profile, job matches and gap report
 */

/**
 * @openapi
 * /me/skills:
 *   get:
 *     summary: My skills, grouped by the evidence behind them
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Skill groups }
 *   post:
 *     summary: Self-declare a skill
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [skillId], properties: { skillId: { type: string, format: uuid } } }
 *     responses:
 *       201: { description: Added }
 */
profileRouter.get('/me/skills', ...student, getMySkills)
profileRouter.post('/me/skills', ...student, addSelfSkill)

/**
 * @openapi
 * /me/custom-skills:
 *   post:
 *     summary: Add a skill that is not in the SkillBridge list (e.g. Canva)
 *     description: |
 *       If the name matches a known skill or alias ("ms excel"), that real skill is added instead
 *       (added = "known"), because only real skills count in job matching. Otherwise it is kept as
 *       the student's own skill (added = "custom"); admins see these and can add them to the list.
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [name], properties: { name: { type: string, example: Canva } } }
 *     responses:
 *       201: { description: "{ added: known | custom, skill }" }
 *       400: { $ref: '#/components/responses/BadRequest' }
 * /me/custom-skills/{id}:
 *   delete:
 *     summary: Remove one of my own skills
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Removed }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
profileRouter.post('/me/custom-skills', ...student, addCustomSkill)
profileRouter.delete('/me/custom-skills/:id', ...student, deleteCustomSkill)

/**
 * @openapi
 * /me/skills/{id}:
 *   delete:
 *     summary: Remove one skill entry
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Removed }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /me/evidence:
 *   delete:
 *     summary: Remove everything one course, certificate or project contributed
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source, evidence]
 *             properties:
 *               source: { type: string, enum: [COURSE, CERTIFICATE, PROJECT, SELF] }
 *               evidence: { type: string, example: IT 221 }
 *     responses:
 *       200: { description: Removed }
 */
profileRouter.delete('/me/skills/:id', ...student, deleteSkill)
profileRouter.delete('/me/evidence', ...student, deleteEvidence)

/**
 * @openapi
 * /me/courses:
 *   post:
 *     summary: Add courses I have taken; their mapped skills are added
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [courseIds], properties: { courseIds: { type: array, items: { type: string } } } }
 *     responses:
 *       201: { description: Skills added }
 * /me/certifications:
 *   post:
 *     summary: Add a certification I hold
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [certificationId], properties: { certificationId: { type: string } } }
 *     responses:
 *       201: { description: Skills added }
 */
profileRouter.post('/me/courses', ...student, addCourses)
profileRouter.post('/me/certifications', ...student, addCertification)

/**
 * @openapi
 * /me/projects/extract:
 *   post:
 *     summary: Detect skills in a project description (nothing is saved)
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description]
 *             properties:
 *               description: { type: string, example: "Built a barangay clinic booking app with React, Node.js and MySQL, deployed with Docker" }
 *     responses:
 *       200: { description: Detected skills }
 * /me/projects:
 *   post:
 *     summary: Save a project with the skills I confirm
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, skillIds]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               skillIds: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Saved }
 */
profileRouter.post('/me/projects/extract', ...student, extractProjectSkills)
profileRouter.post('/me/projects', ...student, saveProject)

/**
 * @openapi
 * /me/matches:
 *   get:
 *     summary: Job postings ranked by fit (READY, then CLOSE, then STRETCH)
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: occupationId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [READY, CLOSE, STRETCH] } }
 *       - { in: query, name: limit, schema: { type: integer, default: 30 } }
 *     responses:
 *       200: { description: Matches with matched and missing skills }
 * /me/gap-report:
 *   get:
 *     summary: Readiness for an occupation, gaps, the skill that unlocks most jobs, and courses to take
 *     description: Without occupationId, the occupation the student is most ready for is used.
 *     tags: [Student]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: occupationId, schema: { type: string } }
 *     responses:
 *       200: { description: Gap report }
 */
profileRouter.get('/me/matches', ...student, getMatches)
profileRouter.get('/me/gap-report', ...student, getGapReport)

export default profileRouter
