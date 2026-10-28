import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import jwt from 'jsonwebtoken'

// Mock the database so tests never touch Postgres
const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    program: { findUnique: jest.fn() },
    course: { findMany: jest.fn() },
    studentSkill: { createMany: jest.fn(), deleteMany: jest.fn() },
    skill: { findMany: jest.fn() },
    occupation: { findMany: jest.fn() },
    jobPosting: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    jobSkill: { deleteMany: jest.fn() },
    importRun: { create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (ops) => ops)
}
jest.unstable_mockModule('../src/configs/postgres.js', () => ({ default: prismaMock }))
jest.unstable_mockModule('../src/logger/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

process.env.JWT_PASS = 'test-access-secret'

const { default: request } = await import('supertest')
const { default: app } = await import('../src/app.js')
const { invalidateTaxonomy } = await import('../src/services/taxonomyCache.js')

const token = (claims) => jwt.sign({ id: 'u1', ...claims }, process.env.JWT_PASS)
const student = token({ role: 'STUDENT', schoolId: 's1', programId: 'p1' })
const schoolAdmin = token({ role: 'SCHOOL_ADMIN', schoolId: 's1' })
const admin = token({ role: 'ADMIN' })
const as = (t) => ({ Authorization: `Bearer ${t}` })

describe('POST /api/auth/register', () => {
    const body = { name: 'Juan', email: 'Juan@Example.com', password: 'longenough', programId: 'p1' }

    it('validates input', async () => {
        expect((await request(app).post('/api/auth/register').send({ ...body, name: '' })).status).toBe(400)
        expect((await request(app).post('/api/auth/register').send({ ...body, password: 'short' })).status).toBe(400)
        expect((await request(app).post('/api/auth/register').send({ ...body, email: 'nope' })).status).toBe(400)
    })

    it('rejects an unknown program', async () => {
        prismaMock.program.findUnique.mockResolvedValue(null)
        expect((await request(app).post('/api/auth/register').send(body)).status).toBe(404)
    })

    it('creates a STUDENT whose school comes from the program, with a lower-cased email', async () => {
        prismaMock.program.findUnique.mockResolvedValue({ id: 'p1', schoolId: 's1' })
        prismaMock.user.findUnique.mockResolvedValue(null)
        prismaMock.user.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }))

        const res = await request(app).post('/api/auth/register').send({ ...body, role: 'ADMIN' })

        expect(res.status).toBe(201)
        expect(prismaMock.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ email: 'juan@example.com', role: 'STUDENT', schoolId: 's1', programId: 'p1' })
        })
        expect(jwt.verify(res.body.accessToken, process.env.JWT_PASS)).toMatchObject({ role: 'STUDENT' })
    })
})

describe('student profile routes', () => {
    it('are for students only', async () => {
        expect((await request(app).get('/api/me/skills').set(as(schoolAdmin))).status).toBe(403)
        expect((await request(app).get('/api/me/skills')).status).toBe(401)
    })

    it('refuse courses from another program', async () => {
        prismaMock.course.findMany.mockResolvedValue([{ id: 'c1', code: 'IT 101', skills: [] }])
        const res = await request(app).post('/api/me/courses').set(as(student)).send({ courseIds: ['c1', 'c-other'] })
        expect(res.status).toBe(400)
        expect(prismaMock.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: { in: ['c1', 'c-other'] }, programId: 'p1' }
        }))
    })

    it('can only delete their own skill rows', async () => {
        prismaMock.studentSkill.deleteMany.mockResolvedValue({ count: 0 })
        const res = await request(app).delete('/api/me/skills/someone-elses').set(as(student))
        expect(res.status).toBe(404)
        expect(prismaMock.studentSkill.deleteMany).toHaveBeenCalledWith({ where: { id: 'someone-elses', userId: 'u1' } })
    })

    it('require a real project description before extracting', async () => {
        const res = await request(app).post('/api/me/projects/extract').set(as(student)).send({ description: 'short' })
        expect(res.status).toBe(400)
    })
})

describe('program insights access', () => {
    it('lets school staff see only their own school', async () => {
        prismaMock.program.findUnique.mockResolvedValue({ schoolId: 'other-school' })
        expect((await request(app).get('/api/programs/p9/insights').set(as(schoolAdmin))).status).toBe(403)
    })

    it('is closed to students', async () => {
        expect((await request(app).get('/api/programs/p1/insights').set(as(student))).status).toBe(403)
    })
})

describe('POST /api/jobs/import', () => {
    const skills = [
        { id: 'sql', name: 'SQL', aliases: [], parentId: null, category: 'Data' },
        { id: 'excel', name: 'Microsoft Excel', aliases: ['excel'], parentId: null, category: 'Office' },
        { id: 'py', name: 'Python', aliases: [], parentId: null, category: 'Programming' }
    ]
    const posting = { title: 'Junior Data Analyst', company: 'Acme', description: 'SQL and Excel required. Python is a plus.', externalId: 'X1' }
    const post = (body) => request(app).post('/api/jobs/import').set(as(admin)).send(body)

    beforeEach(() => {
        invalidateTaxonomy()
        prismaMock.skill.findMany.mockResolvedValue(skills)
        prismaMock.occupation.findMany.mockResolvedValue([{ id: 'occ-da', title: 'Data Analyst', titleKeywords: ['data analyst'] }])
        prismaMock.importRun.create.mockResolvedValue({ id: 'run1' })
        prismaMock.importRun.update.mockImplementation(async ({ data }) => ({ id: 'run1', ...data }))
        prismaMock.jobPosting.findUnique.mockResolvedValue(null)
    })

    it('is admin only', async () => {
        const res = await request(app).post('/api/jobs/import').set(as(student)).send({ source: 's', data: [posting] })
        expect(res.status).toBe(403)
    })

    it('validates format, CSV syntax and empty imports', async () => {
        expect((await post({ source: 's', format: 'xml', data: '' })).body.error.message).toMatch(/json or csv/)
        expect((await post({ source: 's', format: 'csv', data: 'a,b\n"oops' })).body.error.message).toMatch(/unclosed quote/)
        expect((await post({ source: 's', data: [] })).body.error.message).toMatch(/no postings found/)
    })

    it('extracts skills, classifies the occupation and stores the posting', async () => {
        const res = await post({ source: 'jobfair', data: [posting] })

        expect(res.status).toBe(201)
        expect(res.body.data).toMatchObject({ created: 1, duplicates: 0, failed: 0 })
        const { data } = prismaMock.jobPosting.create.mock.calls[0][0]
        expect(data).toMatchObject({ source: 'jobfair', occupationId: 'occ-da', title: 'Junior Data Analyst' })
        expect(data.skills.create).toEqual(expect.arrayContaining([
            { skillId: 'sql', importance: 'REQUIRED' },
            { skillId: 'excel', importance: 'REQUIRED' },
            { skillId: 'py', importance: 'PREFERRED' }
        ]))
    })

    it('counts identical content as a duplicate without writing', async () => {
        prismaMock.jobPosting.findUnique.mockResolvedValueOnce({ id: 'existing' }) // by content hash
        const res = await post({ source: 'jobfair', data: [posting] })
        expect(res.body.data).toMatchObject({ created: 0, duplicates: 1 })
        expect(prismaMock.jobPosting.create).not.toHaveBeenCalled()
    })

    it('updates a known externalId whose content changed, replacing its skills', async () => {
        prismaMock.jobPosting.findUnique
            .mockResolvedValueOnce(null)                 // content hash: new text
            .mockResolvedValueOnce({ id: 'existing' })   // source + externalId: known
        const res = await post({ source: 'jobfair', data: [posting] })

        expect(res.body.data).toMatchObject({ created: 0, updated: 1 })
        expect(prismaMock.jobSkill.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'existing' } })
        expect(prismaMock.jobPosting.update).toHaveBeenCalled()
    })

    it('reports bad items by index and keeps going', async () => {
        const res = await post({ source: 'jobfair', data: [{ company: 'No title' }, posting] })
        expect(res.body.data).toMatchObject({ created: 1, failed: 1, errors: [{ index: 0, reason: 'title is required' }] })
    })
})
