// Tells students when a newly visible posting is a READY or CLOSE match for them.
// Works off JobPosting.notifiedAt, so every posting alerts exactly once, whichever
// way it arrived (upload, AI intake, review, scheduled feed) and however late it
// becomes visible (Remotive's 24 h delay).
import prisma from '../configs/postgres.js'
import { getTaxonomy } from './taxonomyCache.js'
import { expandSkills, scoreJob } from './matching.js'
import { sendToUser, sendToRole } from './realtime.js'
import logger from '../logger/logger.js'

const BATCH = 200
// An alert interrupts the student, so CLOSE matches must also be decent overall
// (a posting listing 3 skills where you have 1 is "close" but only 33%)
const MIN_CLOSE_SCORE = 50
// A posting that only now reached the platform but was published long ago is not "new"
const FRESH_DAYS = 30

const notifyNewPostings = async (now = new Date()) => {
    const jobs = await prisma.jobPosting.findMany({
        where: { notifiedAt: null, visibleAt: { lte: now } },
        take: BATCH,
        orderBy: { visibleAt: 'asc' },
        select: {
            id: true, title: true, company: true, location: true, url: true, source: true, postedAt: true,
            skills: { select: { skillId: true, importance: true } }
        }
    })
    if(!jobs.length) return { postings: 0, notifications: 0 }

    const fresh = jobs.filter(j => now - j.postedAt <= FRESH_DAYS * 86400000)
    const rows = []
    if(fresh.length){
        const taxonomy = await getTaxonomy()
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT' },
            select: { id: true, skills: { select: { skillId: true } } }
        })
        for(const s of students){
            const has = expandSkills(s.skills.map(x => x.skillId), taxonomy.ancestors)
            for(const job of fresh){
                const m = scoreJob(has, job.skills)
                if(m && (m.status === 'READY' || (m.status === 'CLOSE' && m.score >= MIN_CLOSE_SCORE))){
                    rows.push({ userId: s.id, jobId: job.id, status: m.status, score: m.score })
                }
            }
        }
    }

    if(rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true })
    await prisma.jobPosting.updateMany({ where: { id: { in: jobs.map(j => j.id) } }, data: { notifiedAt: now } })

    // Push to whoever is online right now; the rest see them on their next visit
    const jobById = new Map(jobs.map(j => [j.id, j]))
    const created = rows.length
        ? await prisma.notification.findMany({
            where: { jobId: { in: rows.map(r => r.jobId) }, createdAt: { gte: new Date(now.getTime() - 1000) } },
            select: { id: true, userId: true, jobId: true, status: true, score: true, createdAt: true }
        })
        : []
    for(const n of created){
        const job = jobById.get(n.jobId)
        sendToUser(n.userId, 'match', {
            id: n.id, status: n.status, score: n.score, createdAt: n.createdAt,
            job: { id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, source: job.source }
        })
    }

    const summary = { postings: jobs.length, notifications: rows.length }
    if(rows.length) sendToRole('ADMIN', 'activity', { kind: 'notified', at: now, ...summary })
    logger.info({ message: 'Notified students about new postings', ...summary })
    return summary
}

export { notifyNewPostings }
