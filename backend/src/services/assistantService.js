// Career assistant for students. The model never sees the database: it calls tools
// that run the same analytics as the Gap report and Job matches pages, scoped to the
// logged-in student, so every number it quotes comes from the matching engine.
import prisma from '../configs/postgres.js'
import { getTaxonomy } from './taxonomyCache.js'
import { studentMatches, studentGapReport, marketSkills } from './insightService.js'
import { chatCompletion } from './aiClient.js'

const MAX_TOOL_ROUNDS = 5
const MAX_DESCRIPTION = 3000 // characters of a posting's description sent to the model

const SYSTEM_PROMPT = `You are the SkillBridge career assistant. You help a student in the Philippines
understand how their skills compare with real job postings and what to learn next.

Rules:
- Get facts from the tools. Never invent job postings, companies, percentages or courses.
- If a tool returns nothing useful, say so plainly instead of guessing.
- Readiness and match status come from SkillBridge: READY = no required skill missing,
  CLOSE = 1-2 missing, STRETCH = more. "Share" is the fraction of postings asking for a skill.
- Be concrete and brief: short paragraphs or short lists, plain text, no markdown tables.
- Recommend learning resources only from the tool results, with their links.
- Answer in the language the student writes in (English, Filipino or Taglish).
- You cannot change the student's profile. If they want to add a skill, tell them which page to use
  (My skills: add courses, certifications, projects or self-declared skills).
- Stay on careers, skills, jobs and learning. Politely decline anything else.`

const occupationParam = {
    occupation: { type: 'string', description: 'Occupation title, e.g. "Web Developer". Omit for the student\'s best fit / all occupations.' }
}

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'get_gap_report',
            description: 'The student\'s readiness for an occupation: strengths, missing skills ranked by demand, the skills that would make the most postings READY if learned, recommended free resources, and readiness for every other occupation.',
            parameters: { type: 'object', properties: occupationParam }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_job_matches',
            description: 'Real job postings ranked by how well the student matches them, with matched and missing skills per posting.',
            parameters: {
                type: 'object',
                properties: {
                    ...occupationParam,
                    status: { type: 'string', enum: ['READY', 'CLOSE', 'STRETCH'] }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_market_demand',
            description: 'The most demanded skills across recent postings, overall or for one occupation, and posting counts per occupation.',
            parameters: { type: 'object', properties: occupationParam }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_job_details',
            description: 'One posting\'s full description and extracted skills. Use a job id from get_job_matches.',
            parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }
        }
    }
]

// The model may pass a title ("web developer") or an id
const resolveOccupation = async (value) => {
    if(!value) return { id: null }
    const { occupations } = await getTaxonomy()
    const v = String(value).trim().toLowerCase()
    const found = occupations.find(o => o.id === value || o.title.toLowerCase() === v)
        ?? occupations.find(o => o.title.toLowerCase().includes(v) || v.includes(o.title.toLowerCase()))
    return found ? { id: found.id } : { error: `Unknown occupation "${value}"`, available: occupations.map(o => o.title) }
}

const names = (skills) => skills.map(s => s.name)

// Each handler returns plain JSON, trimmed to what the model needs
const handlers = {
    async get_gap_report(user, { occupation }){
        const occ = await resolveOccupation(occupation)
        if(occ.error) return occ
        const r = await studentGapReport(user, occ.id)
        if(!r.occupation) return { error: 'No job postings yet to compare with' }
        return {
            occupation: r.occupation.title,
            postings: r.postings,
            readiness: `${r.readiness}%`,
            jobCounts: r.jobCounts,
            strengths: r.strengths.map(s => ({ skill: s.skill.name, share: s.share })),
            gaps: r.gaps.slice(0, 12).map(g => ({ skill: g.skill.name, share: g.share })),
            learnNext: r.nextBestSkills.map(n => ({ skill: n.skill.name, newlyReady: n.newlyReady, newlyClose: n.newlyClose })),
            resources: r.resources.map(x => ({
                title: x.title, provider: x.provider, url: x.url, hours: x.hours, free: x.free, covers: names(x.covers)
            })),
            otherOccupations: r.otherOccupations.map(o => ({ title: o.title, readiness: `${o.readiness}%`, postings: o.postings }))
        }
    },

    async get_job_matches(user, { occupation, status }){
        const occ = await resolveOccupation(occupation)
        if(occ.error) return occ
        const valid = ['READY', 'CLOSE', 'STRETCH'].includes(status) ? status : undefined
        const r = await studentMatches(user.id, { occupationId: occ.id, status: valid, limit: 10 })
        return {
            counts: r.counts,
            matches: r.data.map(m => ({
                jobId: m.job.id, title: m.job.title, company: m.job.company, location: m.job.location,
                occupation: m.job.occupation, score: m.score, status: m.status,
                missingRequired: names(m.missingRequired), missingPreferred: names(m.missingPreferred),
                matchedRequired: names(m.matchedRequired)
            }))
        }
    },

    async get_market_demand(user, { occupation }){
        const occ = await resolveOccupation(occupation)
        if(occ.error) return occ
        const r = await marketSkills({ occupationId: occ.id, limit: 15 })
        return {
            days: r.days,
            postings: r.postings,
            skills: r.skills.map(s => ({ skill: s.skill.name, share: s.share, required: s.required, preferred: s.preferred })),
            occupations: r.occupations.filter(o => o.postings).map(o => ({ title: o.title, postings: o.postings }))
        }
    },

    async get_job_details(user, { jobId }){
        if(typeof jobId !== 'string' || !jobId) return { error: 'jobId is required' }
        // Same visibility rule as students: delayed postings (Remotive: 24 h) stay hidden until then
        const job = await prisma.jobPosting.findFirst({
            where: { id: jobId, visibleAt: { lte: new Date() } },
            include: {
                occupation: { select: { title: true } },
                skills: { include: { skill: { select: { name: true } } } }
            }
        }).catch(() => null) // a malformed id is "not found", not a crash
        if(!job) return { error: 'Job not found' }
        return {
            title: job.title, company: job.company, location: job.location, url: job.url, postedAt: job.postedAt,
            occupation: job.occupation?.title ?? null,
            skills: job.skills.map(s => ({ skill: s.skill.name, importance: s.importance })),
            description: job.description.length > MAX_DESCRIPTION ? `${job.description.slice(0, MAX_DESCRIPTION)}…` : job.description
        }
    }
}

const runTool = async (user, call) => {
    const handler = handlers[call.function?.name]
    if(!handler) return { error: `Unknown tool ${call.function?.name}` }
    let args
    try{
        args = JSON.parse(call.function.arguments || '{}')
    }catch{
        return { error: 'Arguments were not valid JSON' }
    }
    return handler(user, args ?? {})
}

// history: [{ role: 'user' | 'assistant', content }], already validated, last one from the user
const askAssistant = async (user, history) => {
    const messages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nThe student's name is ${user.name ?? 'not known'}. Today is ${new Date().toISOString().slice(0, 10)}.` },
        ...history
    ]
    const toolsUsed = []

    for(let round = 0; round <= MAX_TOOL_ROUNDS; round++){
        // Last round: no tools offered, so the model has to answer with what it has
        const message = await chatCompletion({ messages, tools: round < MAX_TOOL_ROUNDS ? TOOLS : undefined })
        if(!message.tool_calls?.length){
            return { reply: (message.content ?? '').trim() || 'Sorry, I could not come up with an answer. Try asking another way.', toolsUsed }
        }

        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls })
        for(const call of message.tool_calls){
            toolsUsed.push(call.function?.name)
            const result = await runTool(user, call)
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
        }
    }
    return { reply: 'Sorry, that question needed too many steps. Try asking something more specific.', toolsUsed }
}

export { askAssistant, resolveOccupation, TOOLS }
