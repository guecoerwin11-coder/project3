import prisma from '../configs/postgres.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { BadRequest, Unauthorized, Conflict, NotFound } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const accessToken = (user) => jwt.sign(
    { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId, programId: user.programId },
    process.env.JWT_PASS,
    { expiresIn: '2d' }
)

const publicUser = (user) => ({
    id: user.id, name: user.name, email: user.email, role: user.role, schoolId: user.schoolId, programId: user.programId
})

const checkPassword = (password) => {
    if(typeof password !== 'string' || password.length < 8) throw new BadRequest('password must be at least 8 characters')
}

const freeText = (value, field) => {
    const v = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    if(v.length < 2 || v.length > 120) throw new BadRequest(`${field} must be 2 to 120 characters`)
    return v
}

// Students sign themselves up. Either they pick a program from the list (programId),
// or, when their school is not on SkillBridge yet, they type schoolName + programName.
const register = async (req, res, next) => {
    try{
        const { name, email, password, programId, schoolName, programName } = req.body ?? {}

        if(!name?.trim() || !email || !password){
            throw new BadRequest('name, email and password are required')
        }
        if(!programId && !schoolName){
            throw new BadRequest('choose your program, or type your school and program')
        }
        if(!EMAIL_RE.test(email)) throw new BadRequest('email is not valid')
        checkPassword(password)

        let placement
        if(programId){
            const program = await prisma.program.findUnique({ where: { id: programId } })
            if(!program) throw new NotFound('Program not found')
            placement = { schoolId: program.schoolId, programId: program.id }
        }else{
            const school = freeText(schoolName, 'schoolName')
            const program = freeText(programName, 'programName')
            // A listed school typed by hand would hide the student from its career office
            const listed = await prisma.school.findFirst({
                where: { OR: [{ name: { equals: school, mode: 'insensitive' } }, { code: { equals: school, mode: 'insensitive' } }] }
            })
            if(listed) throw new Conflict(`${listed.name} is already on SkillBridge. Please choose it from the list.`)
            placement = { schoolName: school, programName: program }
        }

        if(await prisma.user.findUnique({ where: { email: email.toLowerCase() } })){
            throw new Conflict('email is already used')
        }

        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase(),
                password: await bcrypt.hash(password, 10),
                role: 'STUDENT',
                ...placement
            }
        })
        logger.info({ message: 'Student registered', userId: user.id, ip: req.ip })
        res.status(201).json({ message: 'register successful', accessToken: accessToken(user), user: publicUser(user) })
    }catch(err){
        next(err)
    }
}

const login = async (req, res, next) => {
    try{
        const { email, password } = req.body ?? {}
        if(!email || !password) throw new BadRequest('email and password are required')

        const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } })
        // Same message for unknown email and wrong password, so emails can't be probed
        if(!user || !(await bcrypt.compare(password, user.password))){
            logger.warn({ message: 'Failed login', ip: req.ip })
            throw new Unauthorized('Invalid email or password')
        }

        res.status(200).json({ message: 'login success', accessToken: accessToken(user), user: publicUser(user) })
    }catch(err){
        next(err)
    }
}

const me = async (req, res, next) => {
    try{
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { school: true, program: true }
        })
        if(!user) throw new NotFound('User no longer exists')
        res.status(200).json({
            data: {
                ...publicUser(user),
                // Unlisted schools come back in the same shape, marked unlisted (no id, no courses)
                school: user.school
                    ? { id: user.school.id, name: user.school.name }
                    : user.schoolName ? { id: null, name: user.schoolName, unlisted: true } : null,
                program: user.program
                    ? { id: user.program.id, code: user.program.code, name: user.program.name }
                    : user.programName ? { id: null, code: user.programName, name: user.programName, unlisted: true } : null
            }
        })
    }catch(err){
        next(err)
    }
}

// ADMIN creates school staff and other admins
const createUser = async (req, res, next) => {
    try{
        const { name, email, password, role, schoolId } = req.body ?? {}
        if(!name || !email || !password || !role) throw new BadRequest('name, email, password and role are required')
        if(!['SCHOOL_ADMIN', 'ADMIN'].includes(role)) throw new BadRequest('role must be SCHOOL_ADMIN or ADMIN (students register themselves)')
        if(!EMAIL_RE.test(email)) throw new BadRequest('email is not valid')
        checkPassword(password)
        if(role === 'SCHOOL_ADMIN'){
            if(!schoolId) throw new BadRequest('SCHOOL_ADMIN needs a schoolId')
            if(!(await prisma.school.findUnique({ where: { id: schoolId } }))) throw new NotFound('School not found')
        }
        if(await prisma.user.findUnique({ where: { email: email.toLowerCase() } })) throw new Conflict('email is already used')

        const user = await prisma.user.create({
            data: {
                name, email: email.toLowerCase(), password: await bcrypt.hash(password, 10), role,
                schoolId: role === 'SCHOOL_ADMIN' ? schoolId : null
            }
        })
        res.status(201).json({ data: publicUser(user) })
    }catch(err){
        next(err)
    }
}

export { register, login, me, createUser, accessToken }
