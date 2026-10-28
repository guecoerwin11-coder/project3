// Runs one automatic source: fetch -> scam screen -> ingest clean postings,
// hold flagged ones for an admin -> record the outcome -> tell admins live.
import prisma from '../configs/postgres.js'
import { adapterFor } from './sourceAdapters.js'
import { ingest } from './ingestionService.js'
import { ruleFlags } from './postingRisk.js'
import { normalizePosting, contentHash } from './postingNormalizer.js'
import { sendToRole } from './realtime.js'
import { BadRequest, NotFound } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const MAX_ITEMS = 2000

// The name postings are stored under. Remotive keeps one fixed name because
// attribution and the 24 h delay are keyed on it.
const sourceName = (source) =>
    source.type === 'REMOTIVE' ? 'remotive' : source.type === 'JOOBLE' ? `jooble:${source.name}` : `feed:${source.name}`

// Never more often than the source allows (Remotive: 4 times a day)
const intervalMinutes = (source) => Math.max(source.intervalMinutes, adapterFor(source.type).minIntervalMinutes)

// The overseas rule is about agencies deploying workers abroad (POEA/DMW license).
// A remote job done from home in the Philippines involves no deployment.
const OVERSEAS_REASON = 'Overseas job: check the agency is POEA/DMW licensed'

// The same scam rules as AI intake: fees, OTP/bank details, unrealistic pay...
// Items that cannot even be normalized go to ingest, which reports them as failed.
const screen = (items, { remoteOnly = false } = {}) => {
    const clean = [], flagged = []
    for(const raw of items){
        let posting
        try{ posting = normalizePosting(raw) }catch{ clean.push(raw); continue }
        let { risk, reasons } = ruleFlags(posting)
        if(remoteOnly && reasons.includes(OVERSEAS_REASON)){
            // That rule is MEDIUM, so dropping it never lowers a HIGH; it only matters when it was the only reason
            reasons = reasons.filter(r => r !== OVERSEAS_REASON)
            if(!reasons.length) risk = 'LOW'
        }
        if(risk === 'LOW') clean.push(raw)
        else flagged.push({ raw, posting, risk, reasons, hash: contentHash(posting) })
    }
    return { clean, flagged }
}

// A flagged posting is held once, not again on every scheduled run
const holdForReview = async (name, f) => {
    const [published, pending] = await Promise.all([
        prisma.jobPosting.findUnique({ where: { contentHash: f.hash }, select: { id: true } }),
        prisma.postingReview.findFirst({ where: { source: name, data: { path: ['contentHash'], equals: f.hash } }, select: { id: true } })
    ])
    if(published || pending) return false
    const { title, company, location, description, url, externalId } = f.posting
    await prisma.postingReview.create({
        data: {
            source: name,
            data: { title, company, location, description, url, externalId, postedAt: f.posting.postedAt, contentHash: f.hash },
            risk: f.risk,
            reasons: f.reasons
        }
    })
    return true
}

// trigger: 'manual' (admin pressed Run now) or 'schedule'
const runSource = async (sourceId, { trigger = 'manual', now = new Date() } = {}) => {
    const source = await prisma.jobSource.findUnique({ where: { id: sourceId } })
    if(!source) throw new NotFound('Job source not found')
    if(!source.enabled) throw new BadRequest('This source is disabled')

    // Manual runs count towards the source's limit too
    const minutes = intervalMinutes(source)
    if(trigger === 'manual' && source.type === 'REMOTIVE' && source.lastRunAt && now - source.lastRunAt < minutes * 60000){
        const wait = Math.ceil((minutes * 60000 - (now - source.lastRunAt)) / 60000)
        throw new BadRequest(`Remotive allows about 4 pulls a day. Next pull possible in ${wait} minutes.`)
    }

    const name = sourceName(source)
    const nextRunAt = new Date(now.getTime() + minutes * 60000)
    try{
        const items = (await adapterFor(source.type).fetch(source)).slice(0, MAX_ITEMS)
        const { clean, flagged } = screen(items, { remoteOnly: source.type === 'REMOTIVE' })
        const run = clean.length ? await ingest(name, clean) : null
        let held = 0
        for(const f of flagged) if(await holdForReview(name, f)) held++

        await prisma.jobSource.update({
            where: { id: source.id },
            data: { lastRunAt: now, lastStatus: 'OK', lastError: null, nextRunAt }
        })
        const summary = {
            source: source.name, type: source.type, trigger, fetched: items.length,
            created: run?.created ?? 0, updated: run?.updated ?? 0, duplicates: run?.duplicates ?? 0,
            failed: run?.failed ?? 0, heldForReview: held, runId: run?.id ?? null
        }
        sendToRole('ADMIN', 'activity', { kind: 'source-run', ok: true, at: now, ...summary })
        logger.info({ message: 'Source run finished', ...summary })
        return summary
    }catch(err){
        await prisma.jobSource.update({
            where: { id: source.id },
            data: { lastRunAt: now, lastStatus: 'FAILED', lastError: String(err.message).slice(0, 300), nextRunAt }
        })
        sendToRole('ADMIN', 'activity', { kind: 'source-run', ok: false, at: now, source: source.name, type: source.type, trigger, error: err.message })
        logger.warn({ message: 'Source run failed', source: source.name, error: err.message })
        throw err
    }
}

export { runSource, screen, sourceName, intervalMinutes }
