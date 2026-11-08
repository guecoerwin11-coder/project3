// Resume maker: the student's own facts -> a clean resume -> the best jobs to apply to.
//
// The AI only improves wording. Every sentence it writes is checked against the facts
// it was given (groundedShare); a bullet that brings in new content (an employer, a tool,
// a number the student never wrote) is dropped and the student's own sentence is used.
// Without an AI key the resume is built from a template, so the feature always works.
import prisma from '../configs/postgres.js'
import { getTaxonomy } from './taxonomyCache.js'
import { extractSkills } from './skillExtractor.js'
import { studentMatches, studentGapReport } from './insightService.js'
import { chatCompletion, aiEnabled } from './aiClient.js'
import { groundedShare } from './postingRisk.js'
import { parseJson } from './aiIntakeService.js'
import { BadRequest } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const MIN_GROUNDED = 0.6
const MIN_SUGGEST_SCORE = 50 // same bar as job alerts
// Wording a resume writer may add without changing the facts
const RESUME_WORDS = `developed built designed created implemented managed led organized coordinated collaborated
worked assisted supported handled prepared improved maintained delivered completed applied used using with
and the for of to in on a an as by from into through across while within team teams members users clients
customers system systems application applications website project projects tasks task data reports report
student students skilled experience experienced knowledge strong solid hands-on practical responsible
including various daily weekly school university academic seeking eager motivated detail-oriented`

const SOURCE_LABEL = { COURSE: 'Course', CERTIFICATE: 'Certificate', PROJECT: 'Project', SELF: 'Self-declared' }

// ---------- input ----------

const str = (v, max, field) => {
    if(v == null || v === '') return ''
    if(typeof v !== 'string') throw new BadRequest(`${field} must be text`)
    const t = v.trim()
    if(t.length > max) throw new BadRequest(`${field} is limited to ${max} characters`)
    return t
}

const list = (v, max, field, mapItem) => {
    if(v == null) return []
    if(!Array.isArray(v)) throw new BadRequest(`${field} must be a list`)
    if(v.length > max) throw new BadRequest(`${field}: at most ${max} entries`)
    return v.map((item, i) => mapItem(item ?? {}, `${field}[${i + 1}]`)).filter(e => Object.values(e).some(Boolean))
}

const cleanInput = (raw) => {
    const c = raw?.contact ?? {}
    const input = {
        contact: {
            fullName: str(c.fullName, 120, 'Full name'),
            email: str(c.email, 120, 'Email'),
            phone: str(c.phone, 40, 'Phone'),
            location: str(c.location, 120, 'Location'),
            link: str(c.link, 200, 'Link')
        },
        targetRole: str(raw?.targetRole, 100, 'Target role'),
        about: str(raw?.about, 1000, 'About you'),
        experience: list(raw?.experience, 6, 'Experience', (e, f) => ({
            role: str(e.role, 120, `${f} role`),
            organization: str(e.organization, 150, `${f} organization`),
            dates: str(e.dates, 60, `${f} dates`),
            location: str(e.location, 100, `${f} location`),
            description: str(e.description, 1500, `${f} description`)
        })),
        education: list(raw?.education, 4, 'Education', (e, f) => ({
            school: str(e.school, 150, `${f} school`),
            degree: str(e.degree, 150, `${f} degree`),
            years: str(e.years, 40, `${f} years`),
            location: str(e.location, 100, `${f} location`)
        })),
        // Typed on the resume itself, on top of the projects already on the profile
        projects: list(raw?.projects, 6, 'Projects', (e, f) => ({
            title: str(e.title, 150, `${f} title`),
            tools: str(e.tools, 200, `${f} tools`),
            description: str(e.description, 1500, `${f} description`)
        })),
        // Typed on the resume itself, on top of the certificates already on the profile
        certifications: list(raw?.certifications, 10, 'Certifications', (e, f) => ({
            name: str(e.name, 150, `${f} name`),
            issuer: str(e.issuer, 150, `${f} issuer`),
            date: str(e.date, 40, `${f} date`)
        })),
        // The student chooses which skills appear: nothing is copied from the profile automatically
        skills: skillList(raw?.skills),
        includeProjects: raw?.includeProjects !== false
    }
    if(!input.contact.fullName) throw new BadRequest('Full name is required')
    if(input.projects.some(p => !p.title)) throw new BadRequest('Each project needs a title')
    if(input.certifications.some(c => !c.name)) throw new BadRequest('Each certification needs a name')
    return input
}

// Profile projects first (when included), then the typed ones, no repeated titles.
// Typed tools "React, Firebase" -> ['React', 'Firebase']
const projectList = (input, profile) => {
    const fromProfile = input.includeProjects ? profile.projects : []
    const seen = new Set(fromProfile.map(p => p.title.toLowerCase()))
    const typed = (input.projects ?? [])
        .filter(p => !seen.has(p.title.toLowerCase()) && seen.add(p.title.toLowerCase()))
        .map(p => ({ title: p.title, description: p.description, skills: p.tools.split(',').map(s => s.trim()).filter(Boolean) }))
    return [...fromProfile, ...typed]
}

// Profile certificates first, then the typed ones ("Google Data Analytics, Coursera (2025)"), no repeats
const certificationLines = (typed, fromProfile) => {
    const seen = new Set(fromProfile.map(n => n.toLowerCase()))
    const extra = typed
        .filter(c => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
        .map(c => `${c.name}${c.issuer ? `, ${c.issuer}` : ''}${c.date ? ` (${c.date})` : ''}`)
    return [...fromProfile, ...extra]
}

const MAX_SKILLS = 40

// ["JavaScript", " react ", "JavaScript"] -> ["JavaScript", "react"] (trimmed, no repeats)
const skillList = (v) => {
    if(v == null) return []
    if(!Array.isArray(v) || v.some(s => typeof s !== 'string')) throw new BadRequest('Skills must be a list of names')
    const seen = new Set()
    const out = []
    for(const raw of v){
        const s = raw.trim().replace(/\s+/g, ' ')
        if(!s) continue
        if(s.length > 60) throw new BadRequest(`Skill "${s.slice(0, 20)}…" is longer than 60 characters`)
        if(seen.has(s.toLowerCase())) continue
        seen.add(s.toLowerCase())
        out.push(s)
    }
    if(out.length > MAX_SKILLS) throw new BadRequest(`At most ${MAX_SKILLS} skills`)
    return out
}

// Typed names -> taxonomy skills where we know them ("ms excel" -> Microsoft Excel, Office),
// anything else kept as typed under "Other"
const resolveSkills = (names, index = new Map()) => {
    const seen = new Set()
    const out = []
    for(const name of names){
        const known = index.get(name.toLowerCase())
        const skill = known ?? { id: null, name, category: 'Other' }
        if(seen.has(skill.name.toLowerCase())) continue
        seen.add(skill.name.toLowerCase())
        out.push(skill)
    }
    return out
}

const buildSkillIndex = (skills) => {
    const index = new Map()
    for(const s of skills){
        for(const term of [s.name, ...(s.aliases ?? [])]) index.set(term.toLowerCase(), { id: s.id, name: s.name, category: s.category })
    }
    return index
}

// ---------- facts from the profile ----------

const loadProfile = async (userId) => {
    const [user, rows, projects, taxonomy, custom] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                name: true, email: true, schoolName: true, programName: true,
                school: { select: { name: true } }, program: { select: { name: true } }
            }
        }),
        prisma.studentSkill.findMany({
            where: { userId },
            select: { source: true, evidence: true, skill: { select: { id: true, name: true, category: true } } }
        }),
        prisma.project.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 6, select: { title: true, description: true } }),
        getTaxonomy(),
        prisma.customSkill.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { name: true } })
    ])
    const skills = new Map(rows.map(r => [r.skill.id, r.skill]))
    const projectSkills = (title) => [...new Set(rows.filter(r => r.source === 'PROJECT' && r.evidence === title).map(r => r.skill.name))]
    return {
        user,
        school: user.school?.name ?? user.schoolName ?? '',
        program: user.program?.name ?? user.programName ?? '',
        skills: [...skills.values()],   // profile skills: offered as suggestions, not put on the resume
        customSkills: custom.map(c => c.name), // the student's own skills, not in the taxonomy
        skillIndex: buildSkillIndex(taxonomy.skills),
        certificates: [...new Set(rows.filter(r => r.source === 'CERTIFICATE').map(r => r.evidence))],
        projects: projects.map(p => ({ ...p, skills: projectSkills(p.title) }))
    }
}

const defaultInput = (profile) => ({
    contact: { fullName: profile.user.name, email: profile.user.email, phone: '', location: '', link: '' },
    targetRole: '',
    about: '',
    experience: [],
    education: [{ school: profile.school, degree: profile.program, years: '', location: '' }].filter(e => e.school || e.degree),
    projects: [],
    certifications: [],
    skills: [],
    includeProjects: true
})

// ---------- template version (no AI) ----------

const sentences = (text) => String(text ?? '')
    .split(/\n+|(?<=[.!?])\s+|\s*[•·]\s*|^\s*[-*]\s+/m)
    .map(s => s.replace(/^[-*•\s]+/, '').trim().replace(/\.$/, ''))
    .filter(s => s.length > 2)
    .slice(0, 5)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))

const groupSkills = (skills) => {
    const groups = new Map()
    for(const s of skills){
        if(!groups.has(s.category)) groups.set(s.category, [])
        groups.get(s.category).push(s.name)
    }
    return [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([category, names]) => ({ category, skills: names.sort() }))
}

const templateContent = (input, profile) => {
    const chosen = resolveSkills(input.skills ?? [], profile.skillIndex)
    const top = chosen.slice(0, 5).map(s => s.name)
    const headline = input.targetRole || profile.program
    return {
        name: input.contact.fullName,
        contact: input.contact,
        headline,
        summary: input.about || [
            profile.program ? `${profile.program} student${profile.school ? ` at ${profile.school}` : ''}` : 'Student',
            top.length ? ` with skills in ${top.slice(0, -1).join(', ')}${top.length > 1 ? ' and ' : ''}${top.at(-1)}` : '',
            input.targetRole ? `, seeking a ${input.targetRole} role` : '',
            '.'
        ].join(''),
        experience: input.experience.map(e => ({
            role: e.role, organization: e.organization, dates: e.dates, location: e.location ?? '', bullets: sentences(e.description)
        })),
        projects: projectList(input, profile).map(p => ({ title: p.title, skills: p.skills, bullets: sentences(p.description) })),
        education: input.education ?? [],
        // In the order the student added them ("Node JS; Express JS; REST APIs"), and grouped
        skillList: chosen.map(s => s.name),
        skillGroups: groupSkills(chosen),
        certifications: certificationLines(input.certifications ?? [], profile.certificates)
    }
}

// ---------- AI version, checked against the facts ----------

const keepGrounded = (bullets, source, fallback) => {
    if(!Array.isArray(bullets)) return fallback
    const pool = `${source}\n${RESUME_WORDS}`
    const kept = bullets
        .filter(b => typeof b === 'string' && b.trim().length > 3 && b.length < 300)
        .map(b => b.trim().replace(/\.$/, ''))
        .filter(b => groundedShare(b, pool) >= MIN_GROUNDED)
        .slice(0, 5)
    return kept.length ? kept : fallback
}

const improveWithAi = async (base, input, profile) => {
    // Only the skills the student put on the resume
    const skillNames = base.skillGroups.flatMap(g => g.skills).join(', ')
    const projects = projectList(input, profile) // same order as base.projects
    const facts = {
        targetRole: input.targetRole || null,
        program: profile.program || null,
        school: profile.school || null,
        about: input.about || null,
        skills: skillNames,
        experience: input.experience.map((e, i) => ({ index: i, role: e.role, organization: e.organization, description: e.description })),
        projects: projects.map((p, i) => ({ index: i, title: p.title, skills: p.skills, description: p.description }))
    }
    const message = await chatCompletion({
        temperature: 0.2,
        maxTokens: 1500,
        messages: [
            {
                role: 'system',
                content: `You polish resumes for students and fresh graduates in the Philippines.
Return ONLY JSON: {"summary":"","experience":[{"index":0,"bullets":[""]}],"projects":[{"index":0,"bullets":[""]}]}
Rules:
- Rewrite ONLY the facts given. Never add employers, tools, skills, numbers, results, awards or dates
  that are not in the facts. If a description is thin, write fewer bullets, not invented ones.
- summary: 2-3 sentences in the third person without "I", built from about/program/skills/targetRole.
  They are a STUDENT: never call them a graduate, alumnus or "experienced" unless "about" says so.
- bullets: start with a past-tense action verb, at most 25 words each, 2-4 per entry.`
            },
            { role: 'user', content: JSON.stringify(facts) }
        ]
    })
    const out = parseJson(message.content)
    if(!out) throw new Error('AI returned no JSON')

    const allFacts = [input.about, profile.program, profile.school, input.targetRole, skillNames,
        ...input.experience.map(e => `${e.role} ${e.organization} ${e.description}`),
        ...projects.map(p => `${p.title} ${p.skills.join(' ')} ${p.description}`)].join('\n')

    const byIndex = (arr, i) => (Array.isArray(arr) ? arr.find(x => x?.index === i)?.bullets : undefined)
    const summary = typeof out.summary === 'string' && groundedShare(out.summary, `${allFacts}\n${RESUME_WORDS}`) >= MIN_GROUNDED
        ? out.summary.trim()
        : base.summary

    return {
        ...base,
        summary,
        experience: base.experience.map((e, i) => ({
            ...e,
            bullets: keepGrounded(byIndex(out.experience, i), `${input.experience[i].role} ${input.experience[i].organization} ${input.experience[i].description} ${skillNames}`, e.bullets)
        })),
        projects: base.projects.map((p, i) => ({
            ...p,
            bullets: keepGrounded(byIndex(out.projects, i), `${p.title} ${p.skills.join(' ')} ${projects[i]?.description ?? ''} ${skillNames}`, p.bullets)
        }))
    }
}

// ---------- suggestions: where to apply ----------

const suggestionsFor = async (user, input, profile) => {
    const taxonomy = await getTaxonomy()
    const target = input.targetRole ? taxonomy.classify(input.targetRole) : null

    const [matches, gap] = await Promise.all([
        studentMatches(user.id, { limit: 100 }),
        studentGapReport(user).catch(() => null)
    ])
    const occupationIdByTitle = new Map(taxonomy.occupations.map(o => [o.title, o.id]))
    const jobs = matches.data
        // "Apply here" must be a real chance: READY, or CLOSE with a decent overall match
        // (a short posting where you have 1 of 4 skills is "close" but only 25%)
        .filter(m => m.status === 'READY' || (m.status === 'CLOSE' && m.score >= MIN_SUGGEST_SCORE))
        // The role they wrote on the resume comes first, then the strongest matches
        .sort((a, b) =>
            (occupationIdByTitle.get(b.job.occupation) === target) - (occupationIdByTitle.get(a.job.occupation) === target) ||
            (a.status === 'READY' ? 0 : 1) - (b.status === 'READY' ? 0 : 1) ||
            b.score - a.score)
        .slice(0, 6)
        .map(m => ({
            job: m.job, score: m.score, status: m.status,
            why: m.matchedRequired.slice(0, 4).map(s => s.name),
            missing: m.missingRequired.map(s => s.name)
        }))

    // Skills the resume lists or talks about that are not on the profile yet: matching cannot see them
    const has = new Set(profile.skills.map(s => s.id))
    const written = [input.about, ...input.experience.map(e => `${e.role}\n${e.description}`),
        ...(input.projects ?? []).map(p => `${p.tools}\n${p.description}`)].join('\n')
    const unlistedIds = new Set([
        ...resolveSkills(input.skills ?? [], profile.skillIndex).map(s => s.id).filter(Boolean),
        ...extractSkills(written, taxonomy.matcher).map(s => s.skillId)
    ])
    const unlisted = [...unlistedIds]
        .filter(id => !has.has(id))
        .map(id => ({ id, name: taxonomy.skillById.get(id)?.name }))

    return {
        jobs,
        occupations: (gap?.otherOccupations ?? []).slice(0, 3),
        targetOccupation: taxonomy.occupations.find(o => o.id === target)?.title ?? null,
        skillsToAdd: unlisted
    }
}

// ---------- public ----------

// Offered as one-click suggestions in the form (the student decides what goes on the resume)
const profileSkillNames = (profile) => [
    ...profile.skills.map(s => ({ name: s.name, category: s.category })),
    ...(profile.customSkills ?? []).map(name => ({ name, category: 'Other' }))
].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

const getResume = async (user) => {
    const [saved, profile] = await Promise.all([prisma.resume.findUnique({ where: { userId: user.id } }), loadProfile(user.id)])
    return {
        // Resumes saved before skills were chosen by hand have no list: start it empty
        input: saved ? { skills: [], projects: [], certifications: [], ...saved.input } : defaultInput(profile),
        profileSkills: profileSkillNames(profile),
        content: saved?.content ?? null,
        generatedBy: saved?.generatedBy ?? null,
        updatedAt: saved?.updatedAt ?? null,
        aiAvailable: aiEnabled(),
        suggestions: saved ? await suggestionsFor(user, saved.input, profile) : null
    }
}

const buildResume = async (user, rawInput) => {
    const input = cleanInput(rawInput)
    const profile = await loadProfile(user.id)
    const base = templateContent(input, profile)

    let content = base, generatedBy = 'TEMPLATE'
    if(aiEnabled()){
        try{
            content = await improveWithAi(base, input, profile)
            generatedBy = 'AI'
        }catch(err){
            logger.warn({ message: 'AI resume polish failed; using the template', error: err.message })
        }
    }

    const saved = await prisma.resume.upsert({
        where: { userId: user.id },
        create: { userId: user.id, input, content, generatedBy },
        update: { input, content, generatedBy }
    })
    return {
        input, content, generatedBy, updatedAt: saved.updatedAt, aiAvailable: aiEnabled(),
        profileSkills: profileSkillNames(profile),
        suggestions: await suggestionsFor(user, input, profile)
    }
}

export { getResume, buildResume, cleanInput, templateContent, keepGrounded, sentences, resolveSkills, buildSkillIndex, SOURCE_LABEL }
