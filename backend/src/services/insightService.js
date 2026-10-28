// Database-backed analytics built on the pure functions in matching.js
import prisma from '../configs/postgres.js'
import { getTaxonomy } from './taxonomyCache.js'
import {
    expandSkills, rankJobs, nextBestSkills, demandProfile, coverage, recommendResources, scoreJob
} from './matching.js'

const DEFAULT_WINDOW_DAYS = 180   // postings older than this are not "the market" anymore
const GAP_MIN_SHARE = 0.15        // ignore skills fewer than ~15% of postings ask for

const since = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

// Recent postings with their skills, optionally limited to some occupations
const loadJobs = async ({ occupationIds = null, days = DEFAULT_WINDOW_DAYS } = {}) => {
    const jobs = await prisma.jobPosting.findMany({
        where: {
            postedAt: { gte: since(days) },
            // Delayed postings (Remotive: 24 h after publication) are not shown before their time
            visibleAt: { lte: new Date() },
            ...(occupationIds && { occupationId: { in: occupationIds } })
        },
        select: {
            id: true, title: true, company: true, location: true, url: true, postedAt: true, occupationId: true, source: true,
            skills: { select: { skillId: true, importance: true } }
        },
        orderBy: { postedAt: 'desc' }
    })
    return jobs
}

const studentSkillIds = async (userId) => {
    const rows = await prisma.studentSkill.findMany({ where: { userId }, select: { skillId: true } })
    return [...new Set(rows.map(r => r.skillId))]
}

const skillRef = (taxonomy, id) => {
    const s = taxonomy.skillById.get(id)
    return s ? { id: s.id, name: s.name, category: s.category } : { id, name: 'Unknown skill' }
}

const round = (n) => Math.round(n * 100) / 100

// Sources whose terms require crediting them next to every job
const attributionFor = (source) => source === 'remotive' ? { name: 'Remotive', url: 'https://remotive.com' } : null

// Ranked job matches for one student
const studentMatches = async (userId, { occupationId, status, limit = 30 } = {}) => {
    const taxonomy = await getTaxonomy()
    const [ids, jobs] = await Promise.all([
        studentSkillIds(userId),
        loadJobs({ occupationIds: occupationId ? [occupationId] : null })
    ])
    const has = expandSkills(ids, taxonomy.ancestors)
    const ranked = rankJobs(has, jobs)
    const counts = { READY: 0, CLOSE: 0, STRETCH: 0 }
    for(const r of ranked) counts[r.match.status]++

    const occupationTitle = new Map(taxonomy.occupations.map(o => [o.id, o.title]))
    return {
        counts,
        data: ranked
            .filter(r => !status || r.match.status === status)
            .slice(0, limit)
            .map(({ job, match }) => ({
                job: {
                    id: job.id, title: job.title, company: job.company, location: job.location, url: job.url,
                    postedAt: job.postedAt, occupation: occupationTitle.get(job.occupationId) ?? null,
                    attribution: attributionFor(job.source)
                },
                score: match.score,
                status: match.status,
                matchedRequired: match.matchedRequired.map(id => skillRef(taxonomy, id)),
                missingRequired: match.missingRequired.map(id => skillRef(taxonomy, id)),
                matchedPreferred: match.matchedPreferred.map(id => skillRef(taxonomy, id)),
                missingPreferred: match.missingPreferred.map(id => skillRef(taxonomy, id))
            }))
    }
}

const loadResources = async () => {
    const rows = await prisma.learningResource.findMany({ include: { skills: { select: { skillId: true } } } })
    return rows.map(r => ({ ...r, skillIds: r.skills.map(s => s.skillId), skills: undefined }))
}

// The gap report: how ready the student is for an occupation, what is missing,
// which single skill unlocks the most jobs, and what to study
const studentGapReport = async (user, occupationId = null) => {
    const taxonomy = await getTaxonomy()
    const ids = await studentSkillIds(user.id)
    const has = expandSkills(ids, taxonomy.ancestors)

    // Without a choice, compare against every occupation and pick the student's best fit
    let targetIds = occupationId ? [occupationId] : null
    const allJobs = await loadJobs()
    const byOccupation = new Map()
    for(const j of allJobs){
        if(!j.occupationId) continue
        if(!byOccupation.has(j.occupationId)) byOccupation.set(j.occupationId, [])
        byOccupation.get(j.occupationId).push(j)
    }

    const fit = taxonomy.occupations
        .filter(o => byOccupation.has(o.id))
        .map(o => {
            const { postings, profile } = demandProfile(byOccupation.get(o.id))
            return { occupation: o, postings, readiness: coverage(has, profile, GAP_MIN_SHARE).percent }
        })
        .sort((a, b) => b.readiness - a.readiness)

    if(!targetIds){
        targetIds = fit.length ? [fit[0].occupation.id] : []
    }

    const jobs = allJobs.filter(j => targetIds.includes(j.occupationId))
    const { postings, profile } = demandProfile(jobs)
    const cov = coverage(has, profile, GAP_MIN_SHARE)
    const ranked = rankJobs(has, jobs)
    const counts = { READY: 0, CLOSE: 0, STRETCH: 0 }
    for(const r of ranked) counts[r.match.status]++

    const next = nextBestSkills(ids, jobs, taxonomy.ancestors)
    const resources = recommendResources(cov.missing.slice(0, 10), await loadResources())

    const target = taxonomy.occupations.find(o => o.id === targetIds[0])
    return {
        occupation: target ? { id: target.id, title: target.title } : null,
        postings,
        readiness: cov.percent,
        jobCounts: counts,
        strengths: cov.covered.slice(0, 10).map(p => ({ skill: skillRef(taxonomy, p.skillId), share: round(p.share) })),
        gaps: cov.missing.map(p => ({ skill: skillRef(taxonomy, p.skillId), share: round(p.share) })),
        nextBestSkills: next.map(n => ({ skill: skillRef(taxonomy, n.skillId), newlyReady: n.newlyReady, newlyClose: n.newlyClose })),
        resources: resources.map(r => ({
            id: r.id, title: r.title, provider: r.provider, url: r.url, hours: r.hours, free: r.free,
            covers: r.covers.map(id => skillRef(taxonomy, id))
        })),
        otherOccupations: fit.map(f => ({ id: f.occupation.id, title: f.occupation.title, readiness: f.readiness, postings: f.postings }))
    }
}

// What a program teaches vs what its target jobs ask for, and how its students are doing
const programInsights = async (programId) => {
    const taxonomy = await getTaxonomy()
    const program = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            school: true,
            occupations: { include: { occupation: true } },
            courses: { include: { skills: { select: { skillId: true } } } },
            students: { where: { role: 'STUDENT' }, select: { id: true } }
        }
    })
    if(!program) return null

    const occupationIds = program.occupations.map(o => o.occupationId)
    const jobs = occupationIds.length ? await loadJobs({ occupationIds }) : []
    const { postings, profile } = demandProfile(jobs)

    // Which course teaches each skill, so a gap can be traced to the curriculum
    // (a Set: one course teaching Excel and Word must count once towards Microsoft Office)
    const taughtBy = new Map()
    for(const c of program.courses){
        for(const { skillId } of c.skills){
            for(const id of expandSkills([skillId], taxonomy.ancestors)){
                if(!taughtBy.has(id)) taughtBy.set(id, new Set())
                taughtBy.get(id).add(c.code)
            }
        }
    }
    const coursesFor = (id) => [...(taughtBy.get(id) ?? [])].sort()
    const curriculum = new Set(taughtBy.keys())
    const cov = coverage(curriculum, profile, GAP_MIN_SHARE)

    // Taught, but no target posting in the window asks for it
    const demanded = new Set(profile.map(p => p.skillId))
    const directlyTaught = new Set(program.courses.flatMap(c => c.skills.map(s => s.skillId)))
    const notInDemand = [...directlyTaught].filter(id => !demanded.has(id))

    // Cohort: each student's best match among target postings, and the gaps they share
    const studentIds = program.students.map(s => s.id)
    const studentRows = studentIds.length
        ? await prisma.studentSkill.findMany({ where: { userId: { in: studentIds } }, select: { userId: true, skillId: true } })
        : []
    const skillsByStudent = new Map(studentIds.map(id => [id, []]))
    for(const r of studentRows) skillsByStudent.get(r.userId).push(r.skillId)

    const topGaps = profile.filter(p => p.share >= GAP_MIN_SHARE)
    const missingCount = new Map(topGaps.map(p => [p.skillId, 0]))
    let ready = 0, close = 0, totalReadiness = 0
    for(const ids of skillsByStudent.values()){
        const has = expandSkills(ids, taxonomy.ancestors)
        let best = null
        for(const j of jobs){
            const m = scoreJob(has, j.skills)
            if(m && (!best || m.missingRequired.length < best.missingRequired.length)) best = m
        }
        if(best?.status === 'READY') ready++
        else if(best?.status === 'CLOSE') close++
        totalReadiness += coverage(has, profile, GAP_MIN_SHARE).percent
        for(const p of topGaps) if(!has.has(p.skillId)) missingCount.set(p.skillId, missingCount.get(p.skillId) + 1)
    }
    const n = studentIds.length

    return {
        program: { id: program.id, code: program.code, name: program.name, school: program.school.name },
        targetOccupations: program.occupations.map(o => ({ id: o.occupation.id, title: o.occupation.title })),
        postings,
        curriculumCoverage: cov.percent,
        // Demanded skills the curriculum does not teach: the main finding for the school
        curriculumGaps: cov.missing.map(p => ({
            skill: skillRef(taxonomy, p.skillId), share: round(p.share), required: p.required, preferred: p.preferred
        })),
        covered: cov.covered.map(p => ({ skill: skillRef(taxonomy, p.skillId), share: round(p.share), courses: coursesFor(p.skillId) })),
        notInDemand: notInDemand.map(id => ({ skill: skillRef(taxonomy, id), courses: coursesFor(id) })),
        cohort: {
            students: n,
            averageReadiness: n ? Math.round(totalReadiness / n) : 0,
            readyForAtLeastOneJob: ready,
            closeToAJob: close,
            commonGaps: [...missingCount.entries()]
                .filter(([, c]) => c > 0)
                .map(([id, c]) => ({ skill: skillRef(taxonomy, id), students: c, percent: Math.round(100 * c / n) }))
                .sort((a, b) => b.students - a.students)
                .slice(0, 10)
        }
    }
}

// Most demanded skills in the market, overall or for one occupation
const marketSkills = async ({ occupationId = null, days = DEFAULT_WINDOW_DAYS, limit = 20 } = {}) => {
    const taxonomy = await getTaxonomy()
    const jobs = await loadJobs({ occupationIds: occupationId ? [occupationId] : null, days })
    const { postings, profile } = demandProfile(jobs)

    const perOccupation = new Map()
    for(const j of jobs) perOccupation.set(j.occupationId, (perOccupation.get(j.occupationId) ?? 0) + 1)

    return {
        days,
        postings,
        skills: profile.slice(0, limit).map(p => ({
            skill: skillRef(taxonomy, p.skillId), share: round(p.share), required: p.required, preferred: p.preferred
        })),
        occupations: taxonomy.occupations
            .map(o => ({ id: o.id, title: o.title, postings: perOccupation.get(o.id) ?? 0 }))
            .sort((a, b) => b.postings - a.postings),
        unclassified: perOccupation.get(null) ?? 0
    }
}

export { studentMatches, studentGapReport, programInsights, marketSkills, studentSkillIds, GAP_MIN_SHARE }
