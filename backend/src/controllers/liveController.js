import prisma from '../configs/postgres.js'
import { BadRequest, Unauthorized } from '../utils/errorClass.js'
import { issueTicket, redeemTicket, addClient } from '../services/realtime.js'

// ---------- live stream ----------

const createTicket = (req, res) => {
    res.status(201).json({ ticket: issueTicket(req.user) })
}

const openStream = async (req, res, next) => {
    try{
        const user = redeemTicket(req.query.ticket)
        if(!user) throw new Unauthorized('Invalid or expired stream ticket')
        if(!addClient(user, res)){
            return res.status(429).json({ success: false, error: { message: 'Too many open tabs', status: 429 } })
        }
        // First message: what the badge should show right now
        const unread = user.role === 'STUDENT'
            ? await prisma.notification.count({ where: { userId: user.id, readAt: null } })
            : 0
        res.write(`event: hello\ndata: ${JSON.stringify({ unread })}\n\n`)
    }catch(err){
        next(err)
    }
}

// ---------- student notifications ----------

const listNotifications = async (req, res, next) => {
    try{
        const [rows, unread] = await Promise.all([
            prisma.notification.findMany({
                where: { userId: req.user.id },
                orderBy: { createdAt: 'desc' },
                take: 50,
                include: { job: { select: { id: true, title: true, company: true, location: true, url: true, source: true, postedAt: true } } }
            }),
            prisma.notification.count({ where: { userId: req.user.id, readAt: null } })
        ])
        res.status(200).json({ unread, data: rows })
    }catch(err){
        next(err)
    }
}

// body { ids: [...] } marks those; no ids marks everything
const markRead = async (req, res, next) => {
    try{
        const { ids } = req.body ?? {}
        if(ids !== undefined && (!Array.isArray(ids) || ids.some(i => typeof i !== 'string'))) throw new BadRequest('ids must be an array')
        const { count } = await prisma.notification.updateMany({
            where: { userId: req.user.id, readAt: null, ...(ids && { id: { in: ids } }) },
            data: { readAt: new Date() }
        })
        res.status(200).json({ marked: count })
    }catch(err){
        next(err)
    }
}

export { createTicket, openStream, listNotifications, markRead }
