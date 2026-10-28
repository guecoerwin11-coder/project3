import express from 'express'
import {
    listSchools, listUnlistedSchools, listCourses, listSkills, createSkill, updateSkill, listOccupations, listCertifications
} from '../controllers/catalogController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'

const catalogRouter = express.Router()

/**
 * @openapi
 * tags:
 *   - name: Catalog
 *     description: Schools, programs, courses, the skills taxonomy, occupations, certifications
 */

/**
 * @openapi
 * /schools:
 *   get:
 *     summary: Schools and their programs (public, used by sign-up)
 *     tags: [Catalog]
 *     responses:
 *       200: { description: Schools }
 */
catalogRouter.get('/schools', listSchools)

/**
 * @openapi
 * /schools/unlisted:
 *   get:
 *     summary: Schools students typed in at sign-up that are not on SkillBridge yet (ADMIN)
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ schoolName, students }], most students first" }
 */
catalogRouter.get('/schools/unlisted', validation, isAuthorize('ADMIN'), listUnlistedSchools)

/**
 * @openapi
 * /programs/{id}/courses:
 *   get:
 *     summary: Courses of a program with the skills each one teaches
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Courses }
 */
catalogRouter.get('/programs/:id/courses', validation, listCourses)

/**
 * @openapi
 * /skills:
 *   get:
 *     summary: Skills taxonomy (search by name or alias with q)
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200: { description: Skills }
 *   post:
 *     summary: Add a skill to the taxonomy (ADMIN). Run /jobs/reextract afterwards.
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category]
 *             properties:
 *               name: { type: string, example: Power BI }
 *               category: { type: string, example: Data }
 *               aliases: { type: array, items: { type: string }, example: [powerbi, power bi desktop] }
 *               parentId: { type: string, format: uuid, description: Broader skill this counts towards }
 *     responses:
 *       201: { description: Created }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
catalogRouter.get('/skills', validation, listSkills)
catalogRouter.post('/skills', validation, isAuthorize('ADMIN'), createSkill)

/**
 * @openapi
 * /skills/{id}:
 *   patch:
 *     summary: Update a skill's category, aliases or parent (ADMIN)
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated }
 */
catalogRouter.patch('/skills/:id', validation, isAuthorize('ADMIN'), updateSkill)

/**
 * @openapi
 * /occupations:
 *   get:
 *     summary: Occupations postings are grouped into
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Occupations }
 * /certifications:
 *   get:
 *     summary: Certifications (e.g. TESDA National Certificates) and the skills they prove
 *     tags: [Catalog]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Certifications }
 */
catalogRouter.get('/occupations', validation, listOccupations)
catalogRouter.get('/certifications', validation, listCertifications)

export default catalogRouter
