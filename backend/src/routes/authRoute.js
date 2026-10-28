import express from 'express'
import { register, login, me, createUser } from '../controllers/authController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'

const authRouter = express.Router()

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Sign-up, login and accounts
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Student sign-up
 *     description: |
 *       Either pick a listed program (programId, which also sets the school), or, when the
 *       school is not on SkillBridge yet, type schoolName and programName. A typed name that
 *       matches a listed school is refused with 409 so the student picks it from the list.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Juan Dela Cruz }
 *               email: { type: string, example: juan@student.local }
 *               password: { type: string, minLength: 8 }
 *               programId: { type: string, format: uuid }
 *               schoolName: { type: string, example: Bulacan State University }
 *               programName: { type: string, example: BS Computer Science }
 *     responses:
 *       201: { description: Registered, returns a token }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
authRouter.post('/auth/register', register)

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Log in
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: ana@student.local }
 *               password: { type: string, example: skillbridge123 }
 *     responses:
 *       200: { description: Token and user }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
authRouter.post('/auth/login', login)

/**
 * @openapi
 * /me:
 *   get:
 *     summary: Current user with school and program
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The user }
 */
authRouter.get('/me', validation, me)

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a SCHOOL_ADMIN or ADMIN account (ADMIN only)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [SCHOOL_ADMIN, ADMIN] }
 *               schoolId: { type: string, format: uuid, description: Required for SCHOOL_ADMIN }
 *     responses:
 *       201: { description: Created }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
authRouter.post('/users', validation, isAuthorize('ADMIN'), createUser)

export default authRouter
