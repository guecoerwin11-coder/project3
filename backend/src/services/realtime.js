// Live updates to browsers with Server-Sent Events (one-way, server -> browser,
// reconnects by itself, works through most proxies, no extra library).
//
// EventSource cannot send an Authorization header, and a JWT in the URL would end
// up in logs and browser history. So the browser first trades its token for a
// short-lived, single-use ticket (POST /api/stream/ticket), then opens
// GET /api/stream?ticket=...
//
// Connections live in this process's memory. With several server instances, put
// a pub/sub (Postgres LISTEN/NOTIFY or Redis) between them.
import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'

const TICKET_TTL_MS = 60 * 1000
const MAX_CONNECTIONS_PER_USER = 5
const HEARTBEAT_MS = 25 * 1000

// In-process event bus: ingestion announces new postings, the notifier listens
export const bus = new EventEmitter()

const tickets = new Map()  // ticket -> { user, expiresAt }
const clients = new Map()  // userId -> Set<{ res, role }>

export const issueTicket = (user) => {
    const now = Date.now()
    for(const [t, v] of tickets) if(v.expiresAt <= now) tickets.delete(t)
    const ticket = randomBytes(24).toString('hex')
    tickets.set(ticket, { user: { id: user.id, role: user.role }, expiresAt: now + TICKET_TTL_MS })
    return ticket
}

export const redeemTicket = (ticket) => {
    const entry = typeof ticket === 'string' ? tickets.get(ticket) : null
    if(!entry) return null
    tickets.delete(ticket) // single use
    return entry.expiresAt > Date.now() ? entry.user : null
}

const write = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Opens the stream on an Express response. Returns false if the user has too many tabs open.
export const addClient = (user, res) => {
    const set = clients.get(user.id) ?? new Set()
    if(set.size >= MAX_CONNECTIONS_PER_USER) return false

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no' // keep nginx from buffering the stream
    })
    res.write('retry: 5000\n\n')

    const client = { res, role: user.role }
    set.add(client)
    clients.set(user.id, set)

    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    res.on('close', () => {
        clearInterval(heartbeat)
        set.delete(client)
        if(!set.size) clients.delete(user.id)
    })
    return true
}

export const sendToUser = (userId, event, data) => {
    for(const c of clients.get(userId) ?? []) write(c.res, event, data)
}

export const sendToRole = (role, event, data) => {
    for(const set of clients.values()) for(const c of set) if(c.role === role) write(c.res, event, data)
}

export const connectedCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0)
