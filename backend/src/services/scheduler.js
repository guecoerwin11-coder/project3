// Runs due sources and sends student alerts, every minute, in the server process.
//
// If several server instances run, only one may do the work: each tick takes a
// Postgres advisory lock first and skips the tick when another instance holds it.
// (Session-level locks need one fixed connection, so the lock uses its own client
// instead of Prisma's pool.)
import pg from 'pg'
import prisma from '../configs/postgres.js'
import { runSource } from './sourceRunner.js'
import { notifyNewPostings } from './notifier.js'
import { bus } from './realtime.js'
import logger from '../logger/logger.js'

const TICK_MS = 60 * 1000
const LOCK_KEY = 720161 // any constant, shared by all SkillBridge instances

let ticking = false

const withLock = async (work) => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try{
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
        if(!rows[0].ok) return false
        try{
            await work()
        }finally{
            await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
        }
        return true
    }finally{
        await client.end()
    }
}

const tick = async () => {
    if(ticking) return
    ticking = true
    try{
        await withLock(async () => {
            const now = new Date()
            const due = await prisma.jobSource.findMany({
                where: { enabled: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
                select: { id: true, name: true }
            })
            for(const s of due){
                // One broken source must not stop the others
                await runSource(s.id, { trigger: 'schedule' }).catch(err =>
                    logger.warn({ message: 'Scheduled run failed', source: s.name, error: err.message }))
            }
            // Also catches postings whose delay (Remotive: 24 h) just ended
            await notifyNewPostings()
        })
    }catch(err){
        logger.error({ message: 'Scheduler tick failed', error: err.message })
    }finally{
        ticking = false
    }
}

// Alerts go out right after an import, not on the next tick
let notifying = null, again = false
const notifySoon = () => {
    if(notifying){ again = true; return }
    notifying = notifyNewPostings()
        .catch(err => logger.error({ message: 'Notify failed', error: err.message }))
        .finally(() => {
            notifying = null
            if(again){ again = false; notifySoon() }
        })
}

const startScheduler = () => {
    bus.on('ingested', notifySoon)
    setTimeout(tick, 5000).unref()
    setInterval(tick, TICK_MS).unref()
    logger.info({ message: 'Scheduler started' })
}

export { startScheduler, tick }
