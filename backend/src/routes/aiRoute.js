import express from 'express'
import { getAiStatus, chat } from '../controllers/aiController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'
import rateLimit from '../middleware/rateLimit.js'

const aiRouter = express.Router()

/**
 * @openapi
 * tags:
 *   - name: AI
 *     description: Career assistant (needs AI_API_KEY, AI_BASE_URL and AI_MODEL in .env)
 */

/**
 * @openapi
 * /ai/status:
 *   get:
 *     summary: Whether the AI assistant is configured on this server
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ enabled: boolean }" }
 * /ai/chat:
 *   post:
 *     summary: Ask the career assistant (students; 30 questions per hour)
 *     description: |
 *       Stateless: send the whole conversation each time (the last 20 messages are used).
 *       The assistant answers from the student's own gap report, job matches and market data.
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string, maxLength: 2000 }
 *                 example: [{ role: user, content: "What should I learn next to become a web developer?" }]
 *     responses:
 *       200: { description: "{ reply, toolsUsed }" }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       429: { description: Rate limit reached }
 *       503: { description: AI not configured or provider unavailable }
 */
aiRouter.get('/ai/status', validation, getAiStatus)
aiRouter.post('/ai/chat', validation, isAuthorize('STUDENT'), rateLimit({ max: 30, windowMs: 60 * 60 * 1000 }), chat)

export default aiRouter
