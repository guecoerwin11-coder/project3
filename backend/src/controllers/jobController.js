import prisma from '../configs/postgres.js'
import { BadRequest, Conflict, Forbidden, NotFound } from '../utils/errorClass.js'
import { ingest, reextractAll } from '../services/ingestionService.js'
import { runSource, intervalMinutes } from '../services/sourceRunner.js'
import { ADAPTERS } from '../services/sourceAdapters.js'
import { parseCsv, InvalidPosting } from '../services/postingNormalizer.js'
import { assertPublicUrl } from '../utils/safeFetch.js'
import { programInsights, marketSkills } from '../services/insightService.js'
import { intakeHiringPosts, listReviews, publishReview, rejectReview } from '../services/aiIntakeService.js'

// ---------- ingestion (ADMIN) ----------

const importJobs = async (req, res, next) => {
    try{
        const { source, format = 'json', data } = req.body ?? {}
        let items
        if(format === 'json'){
            items = data
        }else if(format === 'csv'){
            if(typeof data !== 'string') throw new BadRequest('for csv, data must be the CSV text')
            try{ items = parseCsv(data) }catch(err){
                throw err instanceof InvalidPosting ? new BadRequest(err.message) : err
            }
        }else{
            throw new BadRequest('format must be json or csv')
        }
        const run = await ingest(source, items)
        res.status(201).json({ data: run })
    }catch(err){
        next(err)
    }
}

const listImports = async (req, res, next) => {
    try{
        const runs = await prisma.importRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })
        res.status(200).json({ data: runs })
    }catch(err){
        next(err)
    }
}

const SOURCE_TYPES = Object.keys(ADAPTERS)

const listSources = async (req, res, next) => {
    try{
        const sources = await prisma.jobSource.findMany({ orderBy: { name: 'asc' } })
        res.status(200).json({
            data: sources.map(s => ({ ...s, label: ADAPTERS[s.type].label, effectiveIntervalMinutes: intervalMinutes(s) })),
            types: SOURCE_TYPES.map(t => ({
                type: t, label: ADAPTERS[t].label, minIntervalMinutes: ADAPTERS[t].minIntervalMinutes,
                configured: t !== 'JOOBLE' || Boolean(process.env.JOOBLE_API_KEY)
            }))
        })
    }catch(err){
        next(err)
    }
}

const checkInterval = (value) => {
    if(value === undefined) return undefined
    if(!Number.isInteger(value) || value < 15 || value > 10080) throw new BadRequest('intervalMinutes must be a whole number from 15 to 10080 (one week)')
    return value
}

const checkParams = (params) => {
    if(params === undefined) return undefined
    if(!params || typeof params !== 'object' || Array.isArray(params)) throw new BadRequest('params must be an object')
    if(JSON.stringify(params).length > 2000) throw new BadRequest('params is too large')
    return params
}

const createSource = async (req, res, next) => {
    try{
        const { name, type = 'JSON_FEED', url = null, fieldMap = {}, itemsPath = null, params = {}, intervalMinutes: every } = req.body ?? {}
        if(!name?.trim()) throw new BadRequest('name is required')
        if(!SOURCE_TYPES.includes(type)) throw new BadRequest(`type must be one of ${SOURCE_TYPES.join(', ')}`)
        if(type === 'JSON_FEED'){
            if(!url) throw new BadRequest('url is required for a JSON feed')
            if(typeof fieldMap !== 'object' || Array.isArray(fieldMap) || Object.values(fieldMap).some(v => typeof v !== 'string')){
                throw new BadRequest('fieldMap must map field names to paths, e.g. { "title": "job_title" }')
            }
            await assertPublicUrl(url)
        }
        if(type === 'REMOTIVE' && await prisma.jobSource.findFirst({ where: { type: 'REMOTIVE' } })){
            throw new Conflict('Remotive is already configured; one source is enough (it returns all its jobs)')
        }
        if(await prisma.jobSource.findUnique({ where: { name: name.trim() } })) throw new Conflict('a source with this name exists')

        const source = await prisma.jobSource.create({
            data: {
                name: name.trim(), type,
                url: type === 'JSON_FEED' ? url : null,
                fieldMap: type === 'JSON_FEED' ? fieldMap : {},
                itemsPath: type === 'JSON_FEED' ? itemsPath : null,
                params: checkParams(params),
                intervalMinutes: Math.max(checkInterval(every) ?? ADAPTERS[type].minIntervalMinutes, ADAPTERS[type].minIntervalMinutes)
            }
        })
        res.status(201).json({ data: source })
    }catch(err){
        next(err)
    }
}

// Pause/resume, change how often it runs, or change its options
const updateSource = async (req, res, next) => {
    try{
        const { enabled, intervalMinutes: every, params } = req.body ?? {}
        const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } })
        if(!source) throw new NotFound('Job source not found')
        if(enabled !== undefined && typeof enabled !== 'boolean') throw new BadRequest('enabled must be true or false')

        const updated = await prisma.jobSource.update({
            where: { id: source.id },
            data: {
                ...(enabled !== undefined && { enabled }),
                ...(every !== undefined && { intervalMinutes: Math.max(checkInterval(every), ADAPTERS[source.type].minIntervalMinutes) }),
                ...(params !== undefined && { params: checkParams(params) })
            }
        })
        res.status(200).json({ data: updated })
    }catch(err){
        next(err)
    }
}

const runJobSource = async (req, res, next) => {
    try{
        res.status(201).json({ data: await runSource(req.params.id, { trigger: 'manual' }) })
    }catch(err){
        next(err)
    }
}

const reextract = async (req, res, next) => {
    try{
        res.status(200).json(await reextractAll())
    }catch(err){
        next(err)
    }
}

// ---------- AI intake of pasted hiring posts (ADMIN) ----------

const aiIntake = async (req, res, next) => {
    try{
        const { text, source } = req.body ?? {}
        res.status(201).json({ data: await intakeHiringPosts(text, { source: source || undefined }) })
    }catch(err){
        next(err)
    }
}

const getReviews = async (req, res, next) => {
    try{
        const { status = 'PENDING' } = req.query
        if(!['PENDING', 'PUBLISHED', 'REJECTED'].includes(status)) throw new BadRequest('status must be PENDING, PUBLISHED or REJECTED')
        res.status(200).json({ data: await listReviews(status) })
    }catch(err){
        next(err)
    }
}

const publishPostingReview = async (req, res, next) => {
    try{
        res.status(200).json({ data: await publishReview(req.params.id, req.body ?? {}, req.user.id) })
    }catch(err){
        next(err)
    }
}

const rejectPostingReview = async (req, res, next) => {
    try{
        res.status(200).json({ data: await rejectReview(req.params.id, req.user.id) })
    }catch(err){
        next(err)
    }
}

// ---------- browsing ----------

const listJobs = async (req, res, next) => {
    try{
        const { occupationId, q } = req.query
        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 30, 100)
        const jobs = await prisma.jobPosting.findMany({
            where: {
                ...(occupationId && { occupationId }),
                // Admins see everything, including postings still in their delay window
                ...(req.user.role !== 'ADMIN' && { visibleAt: { lte: new Date() } }),
                ...(q && { OR: [
                    { title: { contains: String(q), mode: 'insensitive' } },
                    { company: { contains: String(q), mode: 'insensitive' } }
                ] })
            },
            orderBy: { postedAt: 'desc' },
            take: limit,
            include: {
                occupation: { select: { id: true, title: true } },
                skills: { include: { skill: { select: { id: true, name: true } } } }
            }
        })
        res.status(200).json({
            data: jobs.map(j => ({
                ...j,
                description: undefined,
                skills: j.skills.map(s => ({ ...s.skill, importance: s.importance }))
            }))
        })
    }catch(err){
        next(err)
    }
}

const getJob = async (req, res, next) => {
    try{
        const job = await prisma.jobPosting.findFirst({
            where: { id: req.params.id, ...(req.user.role !== 'ADMIN' && { visibleAt: { lte: new Date() } }) },
            include: {
                occupation: { select: { id: true, title: true } },
                skills: { include: { skill: { select: { id: true, name: true } } } }
            }
        })
        if(!job) throw new NotFound('Job not found')
        res.status(200).json({ data: { ...job, skills: job.skills.map(s => ({ ...s.skill, importance: s.importance })) } })
    }catch(err){
        next(err)
    }
}

// ---------- analytics ----------

// School staff only see their own school's programs
const getProgramInsights = async (req, res, next) => {
    try{
        const program = await prisma.program.findUnique({ where: { id: req.params.id }, select: { schoolId: true } })
        if(!program) throw new NotFound('Program not found')
        if(req.user.role === 'SCHOOL_ADMIN' && req.user.schoolId !== program.schoolId){
            throw new Forbidden('You can only view programs of your own school')
        }
        res.status(200).json(await programInsights(req.params.id))
    }catch(err){
        next(err)
    }
}

const getMarket = async (req, res, next) => {
    try{
        const days = Number.parseInt(req.query.days ?? '180', 10)
        if(Number.isNaN(days) || days < 7 || days > 730) throw new BadRequest('days must be between 7 and 730')
        res.status(200).json(await marketSkills({ occupationId: req.query.occupationId || null, days }))
    }catch(err){
        next(err)
    }
}

export {
    importJobs, listImports, listSources, createSource, updateSource, runJobSource, reextract,
    aiIntake, getReviews, publishPostingReview, rejectPostingReview,
    listJobs, getJob, getProgramInsights, getMarket
}
