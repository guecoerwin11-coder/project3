import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import jwt from 'jsonwebtoken'

// Mock the database so tests never touch Postgres
const prismaMock = {
    jobPosting: { findMany: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    notification: { createMany: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    skill: { findMany: jest.fn() },
    occupation: { findMany: jest.fn() },
    jobSource: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    postingReview: { findFirst: jest.fn(), create: jest.fn() }
}
jest.unstable_mockModule('../src/configs/postgres.js', () => ({ default: prismaMock }))
jest.unstable_mockModule('../src/logger/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

process.env.JWT_PASS = 'test-access-secret'

const { default: request } = await import('supertest')
const { default: app } = await import('../src/app.js')
const { mapRemotive, remotiveOpenToPh, visibleAtFor } = await import('../src/services/sourceAdapters.js')
const { screen } = await import('../src/services/sourceRunner.js')
const { issueTicket, redeemTicket } = await import('../src/services/realtime.js')
const { notifyNewPostings } = await import('../src/services/notifier.js')
const { invalidateTaxonomy } = await import('../src/services/taxonomyCache.js')

const token = (claims) => jwt.sign({ id: 'u1', ...claims }, process.env.JWT_PASS)
const student = token({ role: 'STUDENT' })
const admin = token({ role: 'ADMIN' })
const as = (t) => ({ Authorization: `Bearer ${t}` })

describe('Remotive adapter', () => {
    const job = {
        id: 123, title: 'Support Engineer', company_name: 'Acme', candidate_required_location: 'Worldwide',
        description: '<p>Help desk</p>', url: 'https://remotive.com/remote-jobs/x-123', publication_date: '2026-10-22T18:40:19'
    }

    it('maps fields, keeps the Remotive link and reads dates as UTC', () => {
        expect(mapRemotive(job)).toEqual({
            externalId: '123', title: 'Support Engineer', company: 'Acme', location: 'Remote (Worldwide)',
            description: '<p>Help desk</p>', url: 'https://remotive.com/remote-jobs/x-123', postedAt: '2026-10-22T18:40:19Z'
        })
    })

    it.each([
        ['Worldwide', true], ['Philippines', true], ['APAC', true], ['Europe, APAC', true], ['Southeast Asia', true],
        ['', true], ['USA only', false], ['Europe', false], ['USA, Canada, USA timezones', false]
    ])('location "%s" open to PH applicants: %s', (loc, open) => {
        expect(remotiveOpenToPh({ candidate_required_location: loc })).toBe(open)
    })
})

describe('visibleAtFor', () => {
    const now = new Date('2026-10-27T00:00:00Z')

    it('delays Remotive jobs until 24 h after publication', () => {
        expect(visibleAtFor('REMOTIVE', '2026-10-26T12:00:00Z', now)).toEqual(new Date('2026-10-27T12:00:00Z'))
    })

    it('shows older Remotive jobs and other sources right away', () => {
        expect(visibleAtFor('REMOTIVE', '2026-10-20T00:00:00Z', now)).toEqual(now)
        expect(visibleAtFor('JSON_FEED', '2026-10-26T23:00:00Z', now)).toEqual(now)
    })
})

describe('scam screening of feed items', () => {
    const base = { title: 'Encoder', company: 'Acme', description: 'Data entry and MS Excel.' }

    it('passes clean postings and holds ones with red flags', () => {
        const { clean, flagged } = screen([
            base,
            { ...base, title: 'Encoder 2', description: 'Pay a processing fee of P500 before your first day.' },
            { ...base, title: 'Encoder 3', description: 'Earn P5,000/day from home!' }
        ])
        expect(clean).toHaveLength(1)
        expect(flagged.map(f => f.risk)).toEqual(['HIGH', 'MEDIUM'])
    })

    it('does not apply the overseas-deployment rule to remote-only sources', () => {
        const remote = { ...base, description: 'Work from home with our overseas clients.' }
        expect(screen([remote]).flagged).toHaveLength(1)
        expect(screen([remote], { remoteOnly: true }).clean).toHaveLength(1)
        // ...but every other red flag still holds it
        const fee = { ...remote, description: 'Overseas clients. Pay a processing fee first.' }
        expect(screen([fee], { remoteOnly: true }).flagged[0]).toMatchObject({ risk: 'HIGH', reasons: ['Asks applicants to pay a fee'] })
    })

    it('lets invalid items through to ingest, which reports them as failed', () => {
        expect(screen([{ company: 'No title' }]).clean).toHaveLength(1)
    })
})

describe('stream tickets', () => {
    it('are single use', () => {
        const t = issueTicket({ id: 'u1', role: 'STUDENT' })
        expect(redeemTicket(t)).toEqual({ id: 'u1', role: 'STUDENT' })
        expect(redeemTicket(t)).toBeNull()
        expect(redeemTicket('made-up')).toBeNull()
    })

    it('need a login to obtain, and the stream refuses a bad ticket', async () => {
        expect((await request(app).post('/api/stream/ticket')).status).toBe(401)
        const res = await request(app).post('/api/stream/ticket').set(as(student))
        expect(res.status).toBe(201)
        expect(res.body.ticket).toMatch(/^[0-9a-f]{48}$/)
        expect((await request(app).get('/api/stream?ticket=nope')).status).toBe(401)
    })
})

describe('notifyNewPostings', () => {
    const now = new Date('2026-10-27T00:00:00Z')

    beforeEach(() => {
        invalidateTaxonomy()
        prismaMock.skill.findMany.mockResolvedValue([{ id: 'sql' }, { id: 'excel' }, { id: 'py' }].map(s => ({ ...s, name: s.id, aliases: [], parentId: null })))
        prismaMock.occupation.findMany.mockResolvedValue([])
        prismaMock.notification.findMany.mockResolvedValue([])
        prismaMock.user.findMany.mockResolvedValue([
            { id: 'ready', skills: [{ skillId: 'sql' }, { skillId: 'excel' }] },
            { id: 'close', skills: [{ skillId: 'sql' }] },
            { id: 'far', skills: [] }
        ])
    })

    it('alerts students who are READY, or CLOSE with a decent score, then marks the posting as notified', async () => {
        prismaMock.jobPosting.findMany.mockResolvedValue([{
            id: 'j1', title: 'Analyst', postedAt: new Date('2026-10-26T00:00:00Z'),
            skills: [{ skillId: 'sql', importance: 'REQUIRED' }, { skillId: 'excel', importance: 'REQUIRED' }, { skillId: 'py', importance: 'REQUIRED' }]
        }])

        const result = await notifyNewPostings(now)

        // ready: missing py = CLOSE 67% -> alert; close: missing 2 = CLOSE but only 33% -> no alert; far: STRETCH
        expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
            data: [{ userId: 'ready', jobId: 'j1', status: 'CLOSE', score: 67 }],
            skipDuplicates: true
        })
        expect(prismaMock.jobPosting.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['j1'] } }, data: { notifiedAt: now } })
        expect(result).toEqual({ postings: 1, notifications: 1 })
    })

    it('only looks at postings that are visible and not yet notified', async () => {
        prismaMock.jobPosting.findMany.mockResolvedValue([])
        await notifyNewPostings(now)
        expect(prismaMock.jobPosting.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { notifiedAt: null, visibleAt: { lte: now } }
        }))
        expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
    })

    it('marks stale postings as notified without alerting anyone', async () => {
        prismaMock.jobPosting.findMany.mockResolvedValue([{
            id: 'old', postedAt: new Date('2026-08-01T00:00:00Z'),
            skills: [{ skillId: 'sql', importance: 'REQUIRED' }, { skillId: 'excel', importance: 'REQUIRED' }]
        }])
        expect(await notifyNewPostings(now)).toEqual({ postings: 1, notifications: 0 })
        expect(prismaMock.user.findMany).not.toHaveBeenCalled()
        expect(prismaMock.jobPosting.updateMany).toHaveBeenCalled()
    })
})

describe('notification endpoints', () => {
    it('only mark the caller\'s own alerts as read', async () => {
        prismaMock.notification.updateMany.mockResolvedValue({ count: 2 })
        const res = await request(app).post('/api/me/notifications/read').set(as(student)).send({ ids: ['n1', 'n2'] })
        expect(res.body).toEqual({ marked: 2 })
        expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1', readAt: null, id: { in: ['n1', 'n2'] } },
            data: { readAt: expect.any(Date) }
        })
    })

    it('are for students', async () => {
        expect((await request(app).get('/api/me/notifications').set(as(admin))).status).toBe(403)
    })
})

describe('job sources', () => {
    const post = (body) => request(app).post('/api/job-sources').set(as(admin)).send(body)

    it('allows only one Remotive source and raises its interval to the 6 h minimum', async () => {
        prismaMock.jobSource.findFirst.mockResolvedValueOnce({ id: 'existing' })
        expect((await post({ name: 'remotive', type: 'REMOTIVE' })).status).toBe(409)

        prismaMock.jobSource.findFirst.mockResolvedValueOnce(null)
        prismaMock.jobSource.findUnique.mockResolvedValueOnce(null)
        prismaMock.jobSource.create.mockImplementation(async ({ data }) => data)
        const res = await post({ name: 'remotive', type: 'REMOTIVE', intervalMinutes: 30 })
        expect(res.status).toBe(201)
        expect(res.body.data).toMatchObject({ type: 'REMOTIVE', intervalMinutes: 360, url: null })
    })

    it('rejects unknown types and feeds without a URL', async () => {
        expect((await post({ name: 'x', type: 'LINKEDIN' })).status).toBe(400)
        expect((await post({ name: 'x', type: 'JSON_FEED' })).status).toBe(400)
    })

    it('refuses a manual Remotive pull inside its rate limit', async () => {
        prismaMock.jobSource.findUnique.mockResolvedValueOnce({
            id: 's1', name: 'remotive', type: 'REMOTIVE', enabled: true, intervalMinutes: 360, lastRunAt: new Date(Date.now() - 60 * 60000)
        })
        const res = await request(app).post('/api/job-sources/s1/run').set(as(admin))
        expect(res.status).toBe(400)
        expect(res.body.error.message).toMatch(/4 pulls a day/)
    })
})
