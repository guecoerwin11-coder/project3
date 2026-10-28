import prisma from '../configs/postgres.js'
import { BadRequest, Conflict, NotFound } from '../utils/errorClass.js'
import { invalidateTaxonomy } from '../services/taxonomyCache.js'

// Public: the sign-up form needs schools and their programs
const listSchools = async (req, res, next) => {
    try{
        const schools = await prisma.school.findMany({
            orderBy: { name: 'asc' },
            include: { programs: { select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } } }
        })
        res.status(200).json({ data: schools })
    }catch(err){
        next(err)
    }
}

// ADMIN: schools students typed in at sign-up, most students first: who to onboard next
const listUnlistedSchools = async (req, res, next) => {
    try{
        const rows = await prisma.user.groupBy({
            by: ['schoolName'],
            where: { role: 'STUDENT', schoolId: null, schoolName: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { schoolName: 'desc' } },
            take: 50
        })
        res.status(200).json({ data: rows.map(r => ({ schoolName: r.schoolName, students: r._count._all })) })
    }catch(err){
        next(err)
    }
}

const listCourses = async (req, res, next) => {
    try{
        const courses = await prisma.course.findMany({
            where: { programId: req.params.id },
            orderBy: { code: 'asc' },
            include: { skills: { include: { skill: { select: { id: true, name: true } } } } }
        })
        res.status(200).json({
            data: courses.map(c => ({ id: c.id, code: c.code, title: c.title, skills: c.skills.map(s => s.skill) }))
        })
    }catch(err){
        next(err)
    }
}

const listSkills = async (req, res, next) => {
    try{
        const q = String(req.query.q ?? '').trim()
        const skills = await prisma.skill.findMany({
            where: q ? {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { aliases: { has: q.toLowerCase() } }
                ]
            } : undefined,
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, category: true, aliases: true, parentId: true }
        })
        res.status(200).json({ data: skills })
    }catch(err){
        next(err)
    }
}

const cleanAliases = (aliases) => {
    if(aliases === undefined) return undefined
    if(!Array.isArray(aliases) || aliases.some(a => typeof a !== 'string')) throw new BadRequest('aliases must be an array of strings')
    return [...new Set(aliases.map(a => a.trim().toLowerCase()).filter(Boolean))]
}

const checkParent = async (parentId, selfId = null) => {
    if(!parentId) return null
    if(parentId === selfId) throw new BadRequest('a skill cannot be its own parent')
    if(!(await prisma.skill.findUnique({ where: { id: parentId } }))) throw new NotFound('Parent skill not found')
    return parentId
}

// ADMIN: grow the taxonomy. Re-run extraction afterwards (POST /jobs/reextract)
const createSkill = async (req, res, next) => {
    try{
        const { name, category, aliases, parentId } = req.body ?? {}
        if(!name?.trim() || !category?.trim()) throw new BadRequest('name and category are required')
        if(await prisma.skill.findUnique({ where: { name: name.trim() } })) throw new Conflict('skill already exists')

        const skill = await prisma.skill.create({
            data: { name: name.trim(), category: category.trim(), aliases: cleanAliases(aliases) ?? [], parentId: await checkParent(parentId) }
        })
        invalidateTaxonomy()
        res.status(201).json({ data: skill })
    }catch(err){
        next(err)
    }
}

const updateSkill = async (req, res, next) => {
    try{
        const { category, aliases, parentId } = req.body ?? {}
        const existing = await prisma.skill.findUnique({ where: { id: req.params.id } })
        if(!existing) throw new NotFound('Skill not found')

        const skill = await prisma.skill.update({
            where: { id: existing.id },
            data: {
                ...(category && { category: category.trim() }),
                ...(aliases !== undefined && { aliases: cleanAliases(aliases) }),
                ...(parentId !== undefined && { parentId: await checkParent(parentId, existing.id) })
            }
        })
        invalidateTaxonomy()
        res.status(200).json({ data: skill })
    }catch(err){
        next(err)
    }
}

const listOccupations = async (req, res, next) => {
    try{
        const occupations = await prisma.occupation.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } })
        res.status(200).json({ data: occupations })
    }catch(err){
        next(err)
    }
}

const listCertifications = async (req, res, next) => {
    try{
        const certs = await prisma.certification.findMany({
            orderBy: { name: 'asc' },
            include: { skills: { include: { skill: { select: { id: true, name: true } } } } }
        })
        res.status(200).json({
            data: certs.map(c => ({ id: c.id, name: c.name, issuer: c.issuer, skills: c.skills.map(s => s.skill) }))
        })
    }catch(err){
        next(err)
    }
}

export {
    listSchools, listUnlistedSchools, listCourses, listSkills, createSkill, updateSkill, listOccupations, listCertifications
}
