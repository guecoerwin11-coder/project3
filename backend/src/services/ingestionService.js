import prisma from '../configs/postgres.js'
import { getTaxonomy } from './taxonomyCache.js'
import { extractSkills } from './skillExtractor.js'
import { InvalidPosting, normalizePosting, contentHash } from './postingNormalizer.js'
import { BadRequest } from '../utils/errorClass.js'
import { bus } from './realtime.js'
import { visibleAtFor } from './sourceAdapters.js'
import logger from '../logger/logger.js'

const MAX_ITEMS = 2000
const MAX_ERRORS_KEPT = 50

// Remotive's terms require a 24 h delay. Applied here rather than in the feed runner,
// so it also holds when an admin publishes a held Remotive posting from the review queue.
const defaultVisibleAt = (source, posting) =>
    source === 'remotive' ? visibleAtFor('REMOTIVE', posting.postedAt) : new Date()

// Extract skills and classify one posting, as data ready for Prisma
const analyze = (posting, taxonomy) => ({
    occupationId: taxonomy.classify(posting.title),
    skills: extractSkills(`${posting.title}\n${posting.description}`, taxonomy.matcher)
        .map(s => ({ skillId: s.skillId, importance: s.importance })),
    extractedAt: new Date()
})

// The pipeline every source goes through:
//   normalize -> dedupe (content hash, or source + externalId) -> extract skills -> classify -> store
// Re-importing the same item is safe. An item whose externalId we know but whose
// content changed is updated in place and re-extracted.
// options.visibleAt(posting) -> Date: when students may first see a new posting (default: now)
const ingest = async (source, rawItems, { visibleAt = null } = {}) => {
    if(typeof source !== 'string' || !source.trim() || source.length > 100) throw new BadRequest('source must be a short name')
    if(!Array.isArray(rawItems)) throw new BadRequest('items must be an array')
    if(rawItems.length === 0) throw new BadRequest('no postings found (for CSV: a header row plus at least one data row)')
    if(rawItems.length > MAX_ITEMS) throw new BadRequest(`import at most ${MAX_ITEMS} postings at a time`)

    const run = await prisma.importRun.create({
        data: { source, received: rawItems.length, created: 0, updated: 0, duplicates: 0, failed: 0 }
    })
    const taxonomy = await getTaxonomy()
    const counts = { created: 0, updated: 0, duplicates: 0, failed: 0 }
    const errors = []

    for(const [index, raw] of rawItems.entries()){
        try{
            const posting = normalizePosting(raw)
            const hash = contentHash(posting)

            if(await prisma.jobPosting.findUnique({ where: { contentHash: hash }, select: { id: true } })){
                counts.duplicates++
                continue
            }

            const { skills, ...analysis } = analyze(posting, taxonomy)
            const existing = posting.externalId
                ? await prisma.jobPosting.findUnique({
                    where: { source_externalId: { source, externalId: posting.externalId } },
                    select: { id: true }
                })
                : null

            if(existing){
                await prisma.$transaction([
                    prisma.jobSkill.deleteMany({ where: { jobId: existing.id } }),
                    prisma.jobPosting.update({
                        where: { id: existing.id },
                        data: { ...posting, ...analysis, contentHash: hash, skills: { create: skills } }
                    })
                ])
                counts.updated++
            }else{
                await prisma.jobPosting.create({
                    data: {
                        ...posting, source, contentHash: hash, ...analysis,
                        visibleAt: visibleAt ? visibleAt(posting) : defaultVisibleAt(source, posting),
                        skills: { create: skills }
                    }
                })
                counts.created++
            }
        }catch(err){
            if(err.code === 'P2002'){
                counts.duplicates++ // a parallel import stored it first
                continue
            }
            if(!(err instanceof InvalidPosting)) logger.error({ message: 'Ingest item failed', source, index, error: err.message })
            counts.failed++
            if(errors.length < MAX_ERRORS_KEPT){
                errors.push({ index, reason: err instanceof InvalidPosting ? err.message : 'unexpected error' })
            }
        }
    }

    const finished = await prisma.importRun.update({
        where: { id: run.id },
        data: { ...counts, errors, finishedAt: new Date() }
    })
    logger.info({ message: 'Import finished', source, ...counts })
    // Whatever the channel, new postings trigger student alerts (see notifier.js)
    if(counts.created || counts.updated) bus.emit('ingested', finished)
    return finished
}

// After the taxonomy changes (new skill, new alias), old postings are re-read
// so analytics reflect the new vocabulary
const reextractAll = async () => {
    const taxonomy = await getTaxonomy()
    let processed = 0, cursor = null
    for(;;){
        const batch = await prisma.jobPosting.findMany({
            take: 200,
            ...(cursor && { skip: 1, cursor: { id: cursor } }),
            orderBy: { id: 'asc' },
            select: { id: true, title: true, description: true }
        })
        if(!batch.length) break

        for(const job of batch){
            const { skills, ...analysis } = analyze(job, taxonomy)
            await prisma.$transaction([
                prisma.jobSkill.deleteMany({ where: { jobId: job.id } }),
                prisma.jobPosting.update({ where: { id: job.id }, data: { ...analysis, skills: { create: skills } } })
            ])
        }
        processed += batch.length
        cursor = batch.at(-1).id
    }
    logger.info({ message: 'Re-extracted all postings', processed })
    return { processed }
}

export { ingest, reextractAll, analyze }
