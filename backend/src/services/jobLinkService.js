// "Paste a job link": read one posting and compare it with the student's own skills.
// Nothing is stored: the posting is the student's private lookup, not part of the
// shared job list (that only takes sources whose owners allow it).
import prisma from '../configs/postgres.js'
import { fetchPage } from '../utils/safeFetch.js'
import { readJobPage } from './jobPageReader.js'
import { getTaxonomy } from './taxonomyCache.js'
import { extractSkills } from './skillExtractor.js'
import { expandSkills, scoreJob, recommendResources } from './matching.js'
import { chatCompletion, aiEnabled } from './aiClient.js'
import { groundedShare } from './postingRisk.js'
import { parseJson } from './aiIntakeService.js'
import { BadRequest } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const MAX_PASTE = 20000
const MIN_PASTE = 80
const MIN_GROUNDED = 0.85 // the AI may only cut the page text down, not write its own

const SOURCE_LABEL = { COURSE: 'Course', CERTIFICATE: 'Certificate', PROJECT: 'Project', SELF: 'Self-declared' }

// When a page has no structured data, its text includes menus, related jobs and
// cookie banners. The AI cuts it down to this one job, copying, never writing.
const isolateWithAi = async (posting) => {
    try{
        const message = await chatCompletion({
            temperature: 0,
            maxTokens: 3000,
            messages: [
                {
                    role: 'system',
                    content: `You receive the text of a web page that shows one job posting, mixed with menus,
footers, related jobs and cookie notices. Return ONLY JSON:
{"title":"","company":"","location":"","description":""}
description: COPY the job's own text (duties, qualifications, requirements), keeping line breaks.
Do not summarize, rewrite, translate or add anything. Use "" for anything not on the page.`
                },
                { role: 'user', content: `Page title: ${posting.title}\n\n${posting.description}` }
            ]
        })
        const out = parseJson(message.content)
        const description = typeof out?.description === 'string' ? out.description.trim() : ''
        if(description.length < 100 || groundedShare(description, posting.description) < MIN_GROUNDED) return posting
        return {
            ...posting,
            title: (typeof out.title === 'string' && out.title.trim()) || posting.title,
            company: (typeof out.company === 'string' && out.company.trim()) || posting.company,
            location: (typeof out.location === 'string' && out.location.trim()) || posting.location,
            description,
            readFrom: 'page-text+ai'
        }
    }catch(err){
        logger.warn({ message: 'AI could not isolate job text; using page text', error: err.message })
        return posting
    }
}

const readPosting = async ({ url, text, title, company }) => {
    if(url){
        if(typeof url !== 'string' || url.length > 2000) throw new BadRequest('Paste a valid link')
        const { html, finalUrl } = await fetchPage(url)
        let posting = readJobPage(html)
        if(!posting){
            throw new BadRequest('Could not find a job description on that page (it may need a login or load with JavaScript). Paste the description instead.')
        }
        if(posting.readFrom === 'page-text' && aiEnabled()) posting = await isolateWithAi(posting)
        return { ...posting, url: finalUrl }
    }
    if(typeof text !== 'string' || text.trim().length < MIN_PASTE) throw new BadRequest(`Paste the job description (at least ${MIN_PASTE} characters), or a link`)
    if(text.length > MAX_PASTE) throw new BadRequest(`Paste at most ${MAX_PASTE.toLocaleString('en')} characters`)
    return {
        title: (typeof title === 'string' && title.trim().slice(0, 200)) || 'Pasted job posting',
        company: (typeof company === 'string' && company.trim().slice(0, 200)) || null,
        location: null,
        description: text.trim(),
        url: null,
        readFrom: 'pasted'
    }
}

// skillId -> ["Course: IT 202", "Project: Clinic app"...], also crediting broader skills
// (a project with MySQL is evidence for "SQL")
const evidenceBySkill = (rows, ancestors) => {
    const map = new Map()
    for(const r of rows){
        const label = `${SOURCE_LABEL[r.source]}${r.evidence ? `: ${r.evidence}` : ''}`
        for(const id of [r.skillId, ...(ancestors.get(r.skillId) ?? [])]){
            if(!map.has(id)) map.set(id, new Set())
            map.get(id).add(label)
        }
    }
    return map
}

const analyzeJob = async (user, input) => {
    const posting = await readPosting(input ?? {})
    const taxonomy = await getTaxonomy()
    const jobSkills = extractSkills(`${posting.title}\n${posting.description}`, taxonomy.matcher)
        .map(s => ({ skillId: s.skillId, importance: s.importance }))

    const rows = await prisma.studentSkill.findMany({ where: { userId: user.id }, select: { skillId: true, source: true, evidence: true } })
    const has = expandSkills([...new Set(rows.map(r => r.skillId))], taxonomy.ancestors)
    const match = scoreJob(has, jobSkills)
    const ref = (id) => ({ id, name: taxonomy.skillById.get(id)?.name ?? 'Unknown skill' })
    const occupation = taxonomy.occupations.find(o => o.id === taxonomy.classify(posting.title))

    const result = {
        posting: {
            title: posting.title, company: posting.company, location: posting.location, url: posting.url,
            readFrom: posting.readFrom, excerpt: posting.description.slice(0, 1500),
            // Full text (capped) so a mock interview can be written from it
            description: posting.description.slice(0, 5000),
            occupation: occupation?.title ?? null, skillsFound: jobSkills.length
        },
        match: null,
        evidence: [],
        resources: [],
        aiAvailable: aiEnabled()
    }
    // Too little recognized to judge fairly (same rule as job matches)
    if(!match) return result

    const evidence = evidenceBySkill(rows, taxonomy.ancestors)
    const missing = [
        ...match.missingRequired.map(id => ({ skillId: id, share: 1 })),
        ...match.missingPreferred.map(id => ({ skillId: id, share: 0.5 }))
    ]
    const resources = await prisma.learningResource.findMany({ include: { skills: { select: { skillId: true } } } })

    result.match = {
        score: match.score,
        status: match.status,
        matchedRequired: match.matchedRequired.map(ref),
        missingRequired: match.missingRequired.map(ref),
        matchedPreferred: match.matchedPreferred.map(ref),
        missingPreferred: match.missingPreferred.map(ref)
    }
    result.evidence = [...match.matchedRequired, ...match.matchedPreferred].map(id => ({
        skill: ref(id), proof: [...(evidence.get(id) ?? [])].slice(0, 3)
    }))
    result.resources = recommendResources(missing, resources.map(r => ({ ...r, skillIds: r.skills.map(s => s.skillId) })))
        .map(r => ({ id: r.id, title: r.title, provider: r.provider, url: r.url, hours: r.hours, free: r.free, covers: r.covers.map(ref) }))
    return result
}

// AI cover letter for one posting, from the student's real profile only
const writeCoverLetter = async (user, posting) => {
    if(!posting?.title || typeof posting.title !== 'string') throw new BadRequest('posting.title is required')
    const description = String(posting.description ?? '').slice(0, 6000)

    const [profile, projects] = await Promise.all([
        prisma.user.findUnique({
            where: { id: user.id },
            select: {
                name: true, schoolName: true, programName: true,
                school: { select: { name: true } }, program: { select: { name: true } },
                skills: { select: { source: true, evidence: true, skill: { select: { name: true } } } }
            }
        }),
        prisma.project.findMany({ where: { userId: user.id }, select: { title: true, description: true }, take: 5 })
    ])
    const facts = {
        name: profile.name,
        school: profile.school?.name ?? profile.schoolName ?? null,
        program: profile.program?.name ?? profile.programName ?? null,
        skills: [...new Set(profile.skills.map(s => s.skill.name))],
        certificates: [...new Set(profile.skills.filter(s => s.source === 'CERTIFICATE').map(s => s.evidence))],
        projects: projects.map(p => ({ title: p.title, description: p.description.slice(0, 600) }))
    }

    const message = await chatCompletion({
        temperature: 0.4,
        maxTokens: 900,
        messages: [
            {
                role: 'system',
                content: `You write short, honest cover letters for students and fresh graduates in the Philippines.
Use ONLY the facts in STUDENT. Never invent jobs, employers, grades, years, numbers, tools or skills.
If the job asks for something the student does not have, do not claim it; at most say they are
learning it. 170-230 words, warm and professional, plain text, no placeholders like [Company].
Start with "Dear Hiring Manager,". End with the student's name.`
            },
            {
                role: 'user',
                content: `STUDENT:\n${JSON.stringify(facts)}\n\nJOB:\nTitle: ${posting.title}\nCompany: ${posting.company ?? 'not stated'}\n${description}`
            }
        ]
    })
    return { letter: String(message.content ?? '').trim() }
}

export { analyzeJob, writeCoverLetter, readPosting, evidenceBySkill }
