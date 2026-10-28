import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import jwt from 'jsonwebtoken'

// Mock the database so tests never touch Postgres
const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    school: { findFirst: jest.fn() },
    program: { findUnique: jest.fn() },
    studentSkill: { findMany: jest.fn() },
    learningResource: { findMany: jest.fn() },
    skill: { findMany: jest.fn() },
    occupation: { findMany: jest.fn() }
}
jest.unstable_mockModule('../src/configs/postgres.js', () => ({ default: prismaMock }))
jest.unstable_mockModule('../src/logger/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

process.env.JWT_PASS = 'test-access-secret'
delete process.env.AI_API_KEY // these tests cover the non-AI paths

const { default: request } = await import('supertest')
const { default: app } = await import('../src/app.js')
const { readJobPage } = await import('../src/services/jobPageReader.js')
const { sentences, keepGrounded, templateContent, cleanInput } = await import('../src/services/resumeService.js')
const { invalidateTaxonomy } = await import('../src/services/taxonomyCache.js')

const student = jwt.sign({ id: 'u1', role: 'STUDENT' }, process.env.JWT_PASS)

// ---------------------------------------------------------------- reading job pages

const ld = (obj) => `<html><head><title>Careers</title><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>menu</body></html>`
const DESCRIPTION = '<p>We are hiring.</p><ul><li>Strong SQL and MS Excel</li><li>Power BI is a plus</li></ul>' + '<p>Work with the finance team on monthly reports and dashboards for management.</p>'.repeat(2)

describe('readJobPage', () => {
    it('reads schema.org JobPosting, even inside @graph, with company and location', () => {
        const page = ld({
            '@context': 'https://schema.org',
            '@graph': [
                { '@type': 'Organization', name: 'Ignore me' },
                {
                    '@type': 'JobPosting', title: 'Junior Data Analyst', datePosted: '2026-10-20',
                    hiringOrganization: { '@type': 'Organization', name: 'Tala Health &amp; Co' },
                    jobLocation: { address: { addressLocality: 'Cebu City', addressRegion: 'Cebu', addressCountry: 'PH' } },
                    description: DESCRIPTION
                }
            ]
        })
        expect(readJobPage(page)).toMatchObject({
            title: 'Junior Data Analyst', company: 'Tala Health & Co', location: 'Cebu City, Cebu, PH', readFrom: 'structured-data'
        })
        expect(readJobPage(page).description).toContain('- Strong SQL and MS Excel')
    })

    it('cleans "[Hiring] ... @Company" titles', () => {
        const page = ld({ '@type': 'JobPosting', title: '[Hiring] Software Engineer, AI Coding Tasks @Askable', hiringOrganization: { name: 'Askable' }, description: DESCRIPTION })
        expect(readJobPage(page).title).toBe('Software Engineer, AI Coding Tasks')
    })

    it('handles an array of JSON-LD objects, a string company and remote jobs', () => {
        const page = ld([{ '@type': 'WebSite' }, { '@type': ['JobPosting'], title: 'QA Tester', hiringOrganization: 'Banwa Labs', jobLocationType: 'TELECOMMUTE', description: DESCRIPTION }])
        expect(readJobPage(page)).toMatchObject({ title: 'QA Tester', company: 'Banwa Labs', location: 'Remote' })
    })

    it('skips broken JSON-LD and falls back to the page text without menus and scripts', () => {
        const page = `<html><head><meta property="og:title" content="Customer Service Rep"><meta property="og:site_name" content="Bituin BPO">
            <script type="application/ld+json">{ broken</script><script>var tracking = 1</script></head>
            <body><nav>Home Jobs Login</nav><main><h1>Customer Service Rep</h1><p>${'Answer customer calls and chats with excellent English. '.repeat(4)}</p></main>
            <footer>© 2026 Cookies</footer></body></html>`
        const p = readJobPage(page)
        expect(p).toMatchObject({ title: 'Customer Service Rep', company: 'Bituin BPO', readFrom: 'page-text' })
        expect(p.description).toContain('excellent English')
        expect(p.description).not.toMatch(/Home Jobs Login|tracking|Cookies/)
    })

    it('returns null for a login wall or an empty app shell', () => {
        expect(readJobPage('<html><body><div id="root"></div><p>Please sign in</p></body></html>')).toBeNull()
    })
})

// ---------------------------------------------------------------- resume

describe('resume helpers', () => {
    it('splits a description into clean bullets', () => {
        expect(sentences('- built the inventory page.\n- Fixed bugs reported by users. Wrote tests')).toEqual([
            'Built the inventory page', 'Fixed bugs reported by users', 'Wrote tests'
        ])
    })

    it('keeps AI bullets that reword the facts and drops ones that invent', () => {
        const source = 'OJT IT intern at City Hall. Fixed computers, set up printers and helped staff with MS Excel'
        const kept = keepGrounded([
            'Fixed computers and set up printers for City Hall staff',
            'Increased network uptime by 40% after migrating 200 servers to AWS'
        ], source, ['fallback'])
        expect(kept).toEqual(['Fixed computers and set up printers for City Hall staff'])
        // Nothing grounded left: the student's own sentences are used
        expect(keepGrounded(['Led a team of 50 engineers at Google'], source, ['Fixed computers'])).toEqual(['Fixed computers'])
    })

    it('builds a template resume from profile facts', () => {
        const input = cleanInput({ contact: { fullName: 'Franco Lim' }, targetRole: 'Junior Web Developer', experience: [{ role: 'Intern', description: 'Built pages. Fixed bugs' }] })
        const r = templateContent(input, {
            program: 'BS Information Technology', school: 'PSI',
            skills: [{ id: 'js', name: 'JavaScript', category: 'Programming' }, { id: 'sql', name: 'SQL', category: 'Data' }],
            certificates: ['CSS NC II'], projects: [{ title: 'Clinic app', description: 'Booking app with React', skills: ['React'] }]
        })
        expect(r.headline).toBe('Junior Web Developer')
        expect(r.summary).toBe('BS Information Technology student at PSI with skills in JavaScript and SQL, seeking a Junior Web Developer role.')
        expect(r.experience[0].bullets).toEqual(['Built pages', 'Fixed bugs'])
        expect(r.projects[0]).toMatchObject({ title: 'Clinic app', skills: ['React'] })
        expect(r.certifications).toEqual(['CSS NC II'])
    })

    it('validates input', () => {
        expect(() => cleanInput({ contact: {} })).toThrow('Full name is required')
        expect(() => cleanInput({ contact: { fullName: 'A' }, experience: Array(7).fill({ role: 'x' }) })).toThrow('at most 6')
        expect(() => cleanInput({ contact: { fullName: 'A' }, about: 'x'.repeat(1001) })).toThrow('limited to 1000')
    })

    it('needs a student to build one', async () => {
        const admin = jwt.sign({ id: 'a', role: 'ADMIN' }, process.env.JWT_PASS)
        expect((await request(app).post('/api/me/resume').set('Authorization', `Bearer ${admin}`).send({ input: {} })).status).toBe(403)
    })
})

// ---------------------------------------------------------------- registration with a typed school

describe('register with a school that is not listed', () => {
    const body = { name: 'Rica', email: 'rica@x.ph', password: 'longenough', schoolName: '  Bulacan  State University ', programName: 'BS Computer Science' }

    beforeEach(() => {
        prismaMock.school.findFirst.mockResolvedValue(null)
        prismaMock.user.findUnique.mockResolvedValue(null)
        prismaMock.user.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }))
    })

    it('stores the typed names as text, without a school or program record', async () => {
        const res = await request(app).post('/api/auth/register').send(body)
        expect(res.status).toBe(201)
        expect(prismaMock.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ schoolName: 'Bulacan State University', programName: 'BS Computer Science', role: 'STUDENT' })
        })
        expect(prismaMock.user.create.mock.calls[0][0].data).not.toHaveProperty('schoolId')
    })

    it('sends students of a listed school back to the list', async () => {
        prismaMock.school.findFirst.mockResolvedValue({ name: 'Pamantasan ng San Isidro' })
        const res = await request(app).post('/api/auth/register').send({ ...body, schoolName: 'psi' })
        expect(res.status).toBe(409)
        expect(res.body.error.message).toMatch(/Pamantasan ng San Isidro is already on SkillBridge/)
    })

    it('needs a program from the list or typed names', async () => {
        expect((await request(app).post('/api/auth/register').send({ ...body, schoolName: undefined })).status).toBe(400)
        expect((await request(app).post('/api/auth/register').send({ ...body, programName: 'x' })).status).toBe(400)
    })
})

// ---------------------------------------------------------------- job check

describe('POST /api/me/job-check', () => {
    const post = (b) => request(app).post('/api/me/job-check').set('Authorization', `Bearer ${student}`).send(b)

    beforeEach(() => {
        invalidateTaxonomy()
        prismaMock.skill.findMany.mockResolvedValue([
            { id: 'sql', name: 'SQL', aliases: [], parentId: null, category: 'Data' },
            { id: 'mysql', name: 'MySQL', aliases: [], parentId: 'sql', category: 'Data' },
            { id: 'excel', name: 'Microsoft Excel', aliases: ['excel'], parentId: null, category: 'Office' },
            { id: 'pbi', name: 'Power BI', aliases: [], parentId: null, category: 'Data' }
        ])
        prismaMock.occupation.findMany.mockResolvedValue([{ id: 'da', title: 'Data Analyst', titleKeywords: ['data analyst'] }])
        prismaMock.studentSkill.findMany.mockResolvedValue([
            { skillId: 'mysql', source: 'PROJECT', evidence: 'Enrollment dashboard' },
            { skillId: 'excel', source: 'COURSE', evidence: 'IT 304' }
        ])
        prismaMock.learningResource.findMany.mockResolvedValue([{ id: 'r1', title: 'Power BI path', provider: 'MS Learn', url: 'https://x', hours: 30, free: true, skills: [{ skillId: 'pbi' }] }])
    })

    it('compares a pasted posting with the student\'s skills and shows where each skill comes from', async () => {
        const res = await post({ title: 'Junior Data Analyst', company: 'Tala', text: 'Requirements:\n- SQL\n- MS Excel\n- Power BI\nYou will build monthly reports for the finance team.' })
        expect(res.status).toBe(200)
        expect(res.body.posting).toMatchObject({ title: 'Junior Data Analyst', occupation: 'Data Analyst', readFrom: 'pasted' })
        expect(res.body.match).toMatchObject({ status: 'CLOSE', missingRequired: [{ id: 'pbi', name: 'Power BI' }] })
        // MySQL from a project counts as evidence for "SQL"
        expect(res.body.evidence).toEqual(expect.arrayContaining([
            { skill: { id: 'sql', name: 'SQL' }, proof: ['Project: Enrollment dashboard'] },
            { skill: { id: 'excel', name: 'Microsoft Excel' }, proof: ['Course: IT 304'] }
        ]))
        expect(res.body.resources[0]).toMatchObject({ title: 'Power BI path', covers: [{ id: 'pbi', name: 'Power BI' }] })
    })

    it('refuses links to private addresses (SSRF)', async () => {
        const res = await post({ url: 'http://127.0.0.1:5432/' })
        expect(res.status).toBe(400)
        expect(res.body.error.message).toMatch(/private network/)
    })

    it('asks for enough text', async () => {
        expect((await post({ text: 'too short' })).status).toBe(400)
    })
})
