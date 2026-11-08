import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import jwt from 'jsonwebtoken'

// Mock the database so tests never touch Postgres
const prismaMock = {
    skill: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    occupation: { findMany: jest.fn() },
    studentSkill: { createMany: jest.fn() },
    customSkill: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
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
const { cleanInput } = await import('../src/services/resumeService.js')

const student = jwt.sign({ id: 'u1', role: 'STUDENT' }, process.env.JWT_PASS)
const admin = jwt.sign({ id: 'a1', role: 'ADMIN' }, process.env.JWT_PASS)
const as = (t) => ({ Authorization: `Bearer ${t}` })

beforeEach(() => {
    invalidateTaxonomy()
    prismaMock.skill.findMany.mockResolvedValue([
        { id: 'excel', name: 'Microsoft Excel', aliases: ['ms excel', 'excel'], parentId: null, category: 'Office' }
    ])
    prismaMock.occupation.findMany.mockResolvedValue([])
    prismaMock.studentSkill.createMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/me/custom-skills', () => {
    const add = (name) => request(app).post('/api/me/custom-skills').set(as(student)).send({ name })

    it('adds the real skill when the name is known (alias, any case and spacing)', async () => {
        const res = await add('  MS   Excel ')
        expect(res.status).toBe(201)
        expect(res.body).toEqual({ added: 'known', skill: { id: 'excel', name: 'Microsoft Excel' } })
        expect(prismaMock.studentSkill.createMany).toHaveBeenCalledWith({
            data: [{ userId: 'u1', skillId: 'excel', source: 'SELF', evidence: '' }], skipDuplicates: true
        })
        expect(prismaMock.customSkill.upsert).not.toHaveBeenCalled()
    })

    it('keeps an unknown skill as the student\'s own, once per spelling', async () => {
        prismaMock.customSkill.upsert.mockResolvedValue({ id: 'c1', name: 'Canva' })
        const res = await add('Canva')
        expect(res.body).toEqual({ added: 'custom', skill: { id: 'c1', name: 'Canva' } })
        expect(prismaMock.customSkill.upsert).toHaveBeenCalledWith({
            where: { userId_nameKey: { userId: 'u1', nameKey: 'canva' } },
            create: { userId: 'u1', name: 'Canva', nameKey: 'canva' },
            update: {}
        })
    })

    it('validates the name', async () => {
        expect((await add('x')).status).toBe(400)
        expect((await add('y'.repeat(61))).status).toBe(400)
        expect((await request(app).post('/api/me/custom-skills').set(as(admin)).send({ name: 'Canva' })).status).toBe(403)
    })

    it('only removes the student\'s own', async () => {
        prismaMock.customSkill.deleteMany.mockResolvedValue({ count: 0 })
        const res = await request(app).delete('/api/me/custom-skills/someone-elses').set(as(student))
        expect(res.status).toBe(404)
        expect(prismaMock.customSkill.deleteMany).toHaveBeenCalledWith({ where: { id: 'someone-elses', userId: 'u1' } })
    })
})

describe('admin adds a skill students typed', () => {
    it('gives every student who typed it the real skill, matching aliases too', async () => {
        prismaMock.skill.findUnique.mockResolvedValue(null)
        prismaMock.skill.create.mockImplementation(async ({ data }) => ({ id: 'canva', ...data }))
        prismaMock.customSkill.findMany.mockResolvedValue([
            { id: 'c1', userId: 'u1' }, { id: 'c2', userId: 'u2' }, { id: 'c3', userId: 'u2' }
        ])

        const res = await request(app).post('/api/skills').set(as(admin))
            .send({ name: 'Canva', category: 'Design', aliases: ['canva pro'] })

        expect(res.status).toBe(201)
        expect(res.body.convertedStudents).toBe(2)
        expect(prismaMock.customSkill.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { nameKey: { in: ['canva', 'canva pro'] } }
        }))
        expect(prismaMock.studentSkill.createMany).toHaveBeenCalledWith({
            data: [
                { userId: 'u1', skillId: 'canva', source: 'SELF', evidence: '' },
                { userId: 'u2', skillId: 'canva', source: 'SELF', evidence: '' }
            ],
            skipDuplicates: true
        })
        expect(prismaMock.customSkill.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1', 'c2', 'c3'] } } })
    })

    it('lists what students typed, most students first (admin only)', async () => {
        prismaMock.customSkill.groupBy.mockResolvedValue([{ nameKey: 'canva', _count: { _all: 3 }, _min: { name: 'Canva' } }])
        const res = await request(app).get('/api/skills/requested').set(as(admin))
        expect(res.body.data).toEqual([{ name: 'Canva', students: 3 }])
        expect((await request(app).get('/api/skills/requested').set(as(student))).status).toBe(403)
    })
})

describe('resume input', () => {
    it('keeps education and the location of each entry (the classic format)', () => {
        const input = cleanInput({
            contact: { fullName: 'A' },
            education: [{ school: 'Dominican College of Tarlac', degree: 'BS Information Technology', years: '2022 - Present', location: 'Capas, Tarlac' }],
            experience: [{ role: 'Customer Service Assistant', organization: 'Waltermart', dates: 'June 2023', location: 'Capas, Tarlac' }]
        })
        expect(input.education[0]).toMatchObject({ location: 'Capas, Tarlac', years: '2022 - Present' })
        expect(input.experience[0].location).toBe('Capas, Tarlac')
    })
})
