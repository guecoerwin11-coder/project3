import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals'
import jwt from 'jsonwebtoken'

const prismaMock = {
    postingReview: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    jobPosting: { findUnique: jest.fn() }
}
const ingestMock = jest.fn()
jest.unstable_mockModule('../src/configs/postgres.js', () => ({ default: prismaMock }))
jest.unstable_mockModule('../src/services/ingestionService.js', () => ({
    ingest: ingestMock, runSource: jest.fn(), reextractAll: jest.fn(), analyze: jest.fn()
}))
jest.unstable_mockModule('../src/logger/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

process.env.JWT_PASS = 'test-access-secret'

const { default: request } = await import('supertest')
const { default: app } = await import('../src/app.js')
const { ruleFlags, groundedShare, maxRisk } = await import('../src/services/postingRisk.js')
const { parseJson } = await import('../src/services/aiIntakeService.js')

const token = (claims) => jwt.sign({ id: 'admin1', ...claims }, process.env.JWT_PASS)
const as = (t) => ({ Authorization: `Bearer ${t}` })
const admin = as(token({ role: 'ADMIN' }))

const realFetch = global.fetch
afterAll(() => { global.fetch = realFetch })

// The AI's answer for one intake call
const aiReturns = (content) => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] })
    })
}

const PASTED = `WE'RE HIRING! 📢
Acme BPO Solutions is looking for Customer Service Representatives in Cebu City.
Qualifications:
- At least senior high school graduate
- Good English communication skills
- Basic computer skills, MS Excel is a plus
Apply at https://acme.example.com/careers

URGENT HIRING: Encoder, work from home, P2,000 per day!
Requirements:
- Typing skills
- Must pay a processing fee of P500 via GCash before training`

const csr = {
    title: 'Customer Service Representative', company: 'Acme BPO Solutions', location: 'Cebu City',
    description: 'Qualifications:\n- At least senior high school graduate\n- Good English communication skills\n- Basic computer skills, MS Excel is a plus',
    url: 'https://acme.example.com/careers', risk: 'LOW', riskReasons: []
}
const encoder = {
    title: 'Encoder', company: '', location: 'Work from home',
    description: 'Requirements:\n- Typing skills\n- Must pay a processing fee of P500 via GCash before training',
    url: '', risk: 'LOW', riskReasons: [] // the AI missed it; the rules must not
}

beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(process.env, { AI_API_KEY: 'k', AI_BASE_URL: 'https://ai.example.com/v1', AI_MODEL: 'm' })
    ingestMock.mockResolvedValue({ id: 'run1', created: 1, updated: 0, duplicates: 0, failed: 0 })
    prismaMock.postingReview.create.mockImplementation(async ({ data }) => ({ id: 'r1', status: 'PENDING', ...data }))
})

describe('ruleFlags', () => {
    const flags = (description) => ruleFlags({ title: 'Job', company: 'Co', description })

    it('flags fee requests and credential requests as HIGH', () => {
        expect(flags('Must pay a processing fee of P500').risk).toBe('HIGH')
        expect(flags('Placement fee is required before deployment').risk).toBe('HIGH')
        expect(flags('Send us the OTP sent to your phone').risk).toBe('HIGH')
    })

    it('flags e-wallet payments, unrealistic pay and overseas jobs as MEDIUM', () => {
        expect(flags('Send P300 to this GCash number to reserve a slot').risk).toBe('MEDIUM')
        expect(flags('No experience needed! Earn P5,000 per day').risk).toBe('MEDIUM')
        expect(flags('Kumita ng ₱3,500 kada araw').risk).toBe('MEDIUM')
        expect(flags('Factory workers for deployment to Taiwan').risk).toBe('MEDIUM')
    })

    it('does not flag normal pay', () => {
        expect(flags('Salary P650/day, P18,000 per month').risk).toBe('LOW')
    })

    it('leaves an ordinary posting LOW', () => {
        const r = flags('Requirements:\n- SQL and Power BI\n- 1 year experience\nSalary: P25,000 per month. Free training provided.')
        expect(r).toEqual({ risk: 'LOW', reasons: [] })
    })

    it('takes the highest risk', () => {
        expect(maxRisk('LOW', 'HIGH', 'MEDIUM')).toBe('HIGH')
        expect(maxRisk()).toBe('LOW')
    })
})

describe('groundedShare', () => {
    it('is high for copied text and low for invented text', () => {
        expect(groundedShare('Good English communication skills', PASTED)).toBe(1)
        expect(groundedShare('Docker Kubernetes Terraform experience required', PASTED)).toBeLessThan(0.5)
    })
})

describe('parseJson', () => {
    it('reads JSON wrapped in fences or prose', () => {
        expect(parseJson('```json\n{"postings":[]}\n```')).toEqual({ postings: [] })
        expect(parseJson('Here you go: {"postings":[{"title":"A"}]} Hope it helps')).toEqual({ postings: [{ title: 'A' }] })
        expect(parseJson('no json here')).toBeNull()
    })
})

describe('POST /api/jobs/ai-intake', () => {
    it('is for admins only', async () => {
        expect((await request(app).post('/api/jobs/ai-intake').set(as(token({ role: 'STUDENT' }))).send({ text: 'x' })).status).toBe(403)
    })

    it('validates the pasted text', async () => {
        expect((await request(app).post('/api/jobs/ai-intake').set(admin).send({})).status).toBe(400)
        expect((await request(app).post('/api/jobs/ai-intake').set(admin).send({ text: 'x'.repeat(20001) })).status).toBe(400)
    })

    it('publishes clean postings through the pipeline and holds scams for review', async () => {
        aiReturns(JSON.stringify({ postings: [csr, encoder] }))

        const res = await request(app).post('/api/jobs/ai-intake').set(admin).send({ text: PASTED, source: 'fb-posts' })

        expect(res.status).toBe(201)
        expect(res.body.data.found).toBe(2)
        expect(ingestMock).toHaveBeenCalledTimes(1)
        expect(ingestMock).toHaveBeenCalledWith('fb-posts', [expect.objectContaining({ title: 'Customer Service Representative', company: 'Acme BPO Solutions' })])

        expect(prismaMock.postingReview.create).toHaveBeenCalledTimes(1)
        const held = prismaMock.postingReview.create.mock.calls[0][0].data
        expect(held.data.title).toBe('Encoder')
        expect(held.risk).toBe('HIGH')
        expect(held.reasons).toEqual(expect.arrayContaining(['Asks applicants to pay a fee', expect.stringMatching(/company is required/)]))
    })

    it('keeps one copy when the AI returns the same job twice', async () => {
        aiReturns(JSON.stringify({ postings: [encoder, { ...encoder, title: ' Encoder ' }, csr] }))
        const res = await request(app).post('/api/jobs/ai-intake').set(admin).send({ text: PASTED })
        expect(res.body.data.found).toBe(2)
        expect(prismaMock.postingReview.create).toHaveBeenCalledTimes(1)
    })

    it('holds a posting whose description the AI invented', async () => {
        aiReturns(JSON.stringify({ postings: [{ ...csr, description: 'Must know Docker, Kubernetes, Terraform and AWS cloud architecture' }] }))
        const res = await request(app).post('/api/jobs/ai-intake').set(admin).send({ text: PASTED })
        expect(res.status).toBe(201)
        expect(ingestMock).not.toHaveBeenCalled()
        expect(prismaMock.postingReview.create.mock.calls[0][0].data.reasons).toEqual([expect.stringMatching(/differs from the pasted text/)])
    })

    it('answers 503 when the AI does not return JSON', async () => {
        aiReturns('Sorry, I cannot help with that.')
        expect((await request(app).post('/api/jobs/ai-intake').set(admin).send({ text: PASTED })).status).toBe(503)
        expect(ingestMock).not.toHaveBeenCalled()
    })
})

describe('job reviews', () => {
    const pending = { id: 'r1', status: 'PENDING', source: 'fb-posts', data: { ...encoder, risk: undefined, riskReasons: undefined } }

    it('publishes with the admin\'s corrections', async () => {
        prismaMock.postingReview.findUnique.mockResolvedValue(pending)
        prismaMock.jobPosting.findUnique.mockResolvedValue({ id: 'job9' })
        prismaMock.postingReview.update.mockImplementation(async ({ data }) => ({ ...pending, ...data }))

        const res = await request(app).post('/api/job-reviews/r1/publish').set(admin).send({ company: 'Verified Data Services Inc.' })

        expect(res.status).toBe(200)
        expect(ingestMock).toHaveBeenCalledWith('fb-posts', [expect.objectContaining({ company: 'Verified Data Services Inc.' })])
        expect(res.body.data.review).toMatchObject({ status: 'PUBLISHED', jobId: 'job9', reviewedBy: 'admin1' })
    })

    it('refuses to publish without the required fields', async () => {
        prismaMock.postingReview.findUnique.mockResolvedValue(pending)
        expect((await request(app).post('/api/job-reviews/r1/publish').set(admin).send({})).status).toBe(400)
        expect(ingestMock).not.toHaveBeenCalled()
    })

    it('cannot act twice on the same review', async () => {
        prismaMock.postingReview.findUnique.mockResolvedValue({ ...pending, status: 'REJECTED' })
        expect((await request(app).post('/api/job-reviews/r1/publish').set(admin).send({})).status).toBe(409)
        expect((await request(app).post('/api/job-reviews/r1/reject').set(admin)).status).toBe(409)
    })
})
