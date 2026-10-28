import express from 'express'
import { createTicket, openStream, listNotifications, markRead } from '../controllers/liveController.js'
import validation from '../middleware/validation.js'
import isAuthorize from '../middleware/isAuthorize.js'
import rateLimit from '../middleware/rateLimit.js'

const liveRouter = express.Router()

/**
 * @openapi
 * tags:
 *   - name: Live
 *     description: Real-time updates (Server-Sent Events) and student job alerts
 */

/**
 * @openapi
 * /stream/ticket:
 *   post:
 *     summary: Trade your token for a single-use ticket (valid 60 s) to open the live stream
 *     tags: [Live]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ ticket }" }
 * /stream:
 *   get:
 *     summary: Live event stream (text/event-stream)
 *     description: |
 *       Open with `new EventSource('/api/stream?ticket=...')`.
 *       Events: `hello` { unread }, `match` (students: a new posting is a READY/CLOSE match),
 *       `activity` (admins: source runs and alerts sent).
 *     tags: [Live]
 *     parameters:
 *       - { in: query, name: ticket, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Event stream }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
liveRouter.post('/stream/ticket', validation, rateLimit({ max: 120, windowMs: 60 * 60 * 1000 }), createTicket)
liveRouter.get('/stream', openStream)

/**
 * @openapi
 * /me/notifications:
 *   get:
 *     summary: My job alerts (newest first) and the unread count
 *     tags: [Live]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ unread, data }" }
 * /me/notifications/read:
 *   post:
 *     summary: Mark alerts as read (all of them when no ids are given)
 *     tags: [Live]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { ids: { type: array, items: { type: string } } } }
 *     responses:
 *       200: { description: "{ marked }" }
 */
liveRouter.get('/me/notifications', validation, isAuthorize('STUDENT'), listNotifications)
liveRouter.post('/me/notifications/read', validation, isAuthorize('STUDENT'), markRead)

export default liveRouter
