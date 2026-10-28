import prisma from '../configs/postgres.js'
import { BadRequest, Forbidden, NotFound } from '../utils/errorClass.js'
import { getTaxonomy } from '../services/taxonomyCache.js'
import { extractSkills } from '../services/skillExtractor.js'
import { studentMatches, studentGapReport } from '../services/insightService.js'

const SOURCES = ['COURSE', 'CERTIFICATE', 'PROJECT', 'SELF']

const addSkills = (userId, skillIds, source, evidence) => prisma.studentSkill.createMany({
    data: skillIds.map(skillId => ({ userId, skillId, source, evidence })),
    skipDuplicates: true
})

// Skills grouped by the evidence behind them (course, certificate, project, self)
const getMySkills = async (req, res, next) => {
    try{
        const rows = await prisma.studentSkill.findMany({
            where: { userId: req.user.id },
            include: { skill: { select: { id: true, name: true, category: true } } },
            orderBy: { createdAt: 'asc' }
        })

        const groups = new Map()
        for(const r of rows){
            const k = `${r.source}|${r.evidence}`
            if(!groups.has(k)) groups.set(k, { source: r.source, evidence: r.evidence, skills: [] })
            groups.get(k).skills.push({ rowId: r.id, ...r.skill })
        }
        const unique = new Map(rows.map(r => [r.skill.id, r.skill]))
        res.status(200).json({ totalSkills: unique.size, groups: [...groups.values()] })
    }catch(err){
        next(err)
    }
}

const addSelfSkill = async (req, res, next) => {
    try{
        const { skillId } = req.body ?? {}
        if(!skillId || !(await prisma.skill.findUnique({ where: { id: skillId } }))) throw new NotFound('Skill not found')
        await addSkills(req.user.id, [skillId], 'SELF', '')
        res.status(201).json({ message: 'skill added' })
    }catch(err){
        next(err)
    }
}

const deleteSkill = async (req, res, next) => {
    try{
        const { count } = await prisma.studentSkill.deleteMany({ where: { id: req.params.id, userId: req.user.id } })
        if(!count) throw new NotFound('Skill not found on your profile')
        res.status(200).json({ message: 'skill removed' })
    }catch(err){
        next(err)
    }
}

// Remove everything a course / certificate / project contributed
const deleteEvidence = async (req, res, next) => {
    try{
        const { source, evidence } = req.body ?? {}
        if(!SOURCES.includes(source) || typeof evidence !== 'string') throw new BadRequest('source and evidence are required')
        const { count } = await prisma.studentSkill.deleteMany({ where: { userId: req.user.id, source, evidence } })
        if(source === 'PROJECT') await prisma.project.deleteMany({ where: { userId: req.user.id, title: evidence } })
        res.status(200).json({ removed: count })
    }catch(err){
        next(err)
    }
}

// Courses taken -> the skills the school mapped to each course
const addCourses = async (req, res, next) => {
    try{
        const { courseIds } = req.body ?? {}
        if(!Array.isArray(courseIds) || !courseIds.length) throw new BadRequest('courseIds must be a non-empty array')
        if(!req.user.programId) throw new Forbidden('Your account is not enrolled in a program')

        const courses = await prisma.course.findMany({
            where: { id: { in: courseIds }, programId: req.user.programId },
            include: { skills: { select: { skillId: true } } }
        })
        if(courses.length !== new Set(courseIds).size) throw new BadRequest('Some courses are not part of your program')

        let added = 0
        for(const c of courses){
            const { count } = await addSkills(req.user.id, c.skills.map(s => s.skillId), 'COURSE', c.code)
            added += count
        }
        res.status(201).json({ added })
    }catch(err){
        next(err)
    }
}

const addCertification = async (req, res, next) => {
    try{
        const { certificationId } = req.body ?? {}
        const cert = certificationId && await prisma.certification.findUnique({
            where: { id: certificationId }, include: { skills: { select: { skillId: true } } }
        })
        if(!cert) throw new NotFound('Certification not found')

        const { count } = await addSkills(req.user.id, cert.skills.map(s => s.skillId), 'CERTIFICATE', cert.name)
        res.status(201).json({ added: count })
    }catch(err){
        next(err)
    }
}

const validateProject = (title, description) => {
    if(typeof description !== 'string' || description.trim().length < 20) throw new BadRequest('describe the project in at least 20 characters')
    if(description.length > 5000) throw new BadRequest('description is limited to 5000 characters')
    if(title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 150)){
        throw new BadRequest('title is required (max 150 characters)')
    }
}

// Step 1: the student describes a project and sees which skills were detected
const extractProjectSkills = async (req, res, next) => {
    try{
        const { description } = req.body ?? {}
        validateProject(undefined, description)
        const taxonomy = await getTaxonomy()
        const found = extractSkills(description, taxonomy.matcher)
        res.status(200).json({
            data: found.map(f => {
                const s = taxonomy.skillById.get(f.skillId)
                return { id: s.id, name: s.name, category: s.category, matched: f.term }
            })
        })
    }catch(err){
        next(err)
    }
}

// Step 2: the student confirms which detected skills they really used
const saveProject = async (req, res, next) => {
    try{
        const { title, description, skillIds } = req.body ?? {}
        validateProject(title, description)
        if(!Array.isArray(skillIds) || !skillIds.length) throw new BadRequest('choose at least one skill')

        const valid = await prisma.skill.count({ where: { id: { in: skillIds } } })
        if(valid !== new Set(skillIds).size) throw new BadRequest('some skills do not exist')

        const project = await prisma.project.create({
            data: { userId: req.user.id, title: title.trim(), description: description.trim() }
        })
        const { count } = await addSkills(req.user.id, skillIds, 'PROJECT', project.title)
        res.status(201).json({ data: project, added: count })
    }catch(err){
        next(err)
    }
}

const getMatches = async (req, res, next) => {
    try{
        const { occupationId, status } = req.query
        if(status && !['READY', 'CLOSE', 'STRETCH'].includes(status)) throw new BadRequest('status must be READY, CLOSE or STRETCH')
        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 30, 100)
        res.status(200).json(await studentMatches(req.user.id, { occupationId, status, limit }))
    }catch(err){
        next(err)
    }
}

const getGapReport = async (req, res, next) => {
    try{
        const { occupationId } = req.query
        if(occupationId && !(await prisma.occupation.findUnique({ where: { id: occupationId } }))){
            throw new NotFound('Occupation not found')
        }
        res.status(200).json(await studentGapReport(req.user, occupationId || null))
    }catch(err){
        next(err)
    }
}

export {
    getMySkills, addSelfSkill, deleteSkill, deleteEvidence, addCourses, addCertification,
    extractProjectSkills, saveProject, getMatches, getGapReport
}
