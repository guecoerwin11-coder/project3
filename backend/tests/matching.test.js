import { describe, it, expect } from '@jest/globals'
import {
    buildAncestors, expandSkills, scoreJob, rankJobs, nextBestSkills,
    demandProfile, coverage, recommendResources
} from '../src/services/matching.js'

const skills = [
    { id: 'sql' }, { id: 'mysql', parentId: 'sql' },
    { id: 'js' }, { id: 'react', parentId: 'js' },
    { id: 'git' }, { id: 'docker' }, { id: 'excel' }, { id: 'comm' }
]
const ancestors = buildAncestors(skills)
const req = (...ids) => ids.map(skillId => ({ skillId, importance: 'REQUIRED' }))
const pref = (...ids) => ids.map(skillId => ({ skillId, importance: 'PREFERRED' }))
const job = (id, skillList, postedAt = new Date('2026-10-01')) => ({ id, skills: skillList, postedAt })

describe('skill hierarchy', () => {
    it('a specific skill satisfies its broader parent, not the other way round', () => {
        expect([...expandSkills(['mysql'], ancestors)].sort()).toEqual(['mysql', 'sql'])
        expect([...expandSkills(['sql'], ancestors)]).toEqual(['sql'])
    })

    it('survives a cycle in the taxonomy', () => {
        const a = buildAncestors([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }])
        expect(a.get('a')).toEqual(['b'])
    })
})

describe('scoreJob', () => {
    it('weighs required skills double and labels the job', () => {
        const has = expandSkills(['mysql', 'git'], ancestors)
        const m = scoreJob(has, [...req('sql', 'git', 'js'), ...pref('docker')])
        // (2*2 + 0) / (2*3 + 1) = 57%
        expect(m).toMatchObject({ score: 57, status: 'CLOSE', missingRequired: ['js'], missingPreferred: ['docker'] })
    })

    it('is READY when nothing required is missing, even with preferred gaps', () => {
        expect(scoreJob(new Set(['git', 'js']), [...req('git', 'js'), ...pref('docker')]).status).toBe('READY')
    })

    it('is STRETCH beyond two missing required skills', () => {
        expect(scoreJob(new Set(), req('a', 'b', 'c')).status).toBe('STRETCH')
    })

    it('cannot judge a posting with too little extracted', () => {
        expect(scoreJob(new Set(['git']), [])).toBeNull()
        // "Warehouse Supervisor: Excel" must not be a 100% READY match
        expect(scoreJob(new Set(['excel']), req('excel'))).toBeNull()
        // "Delivery Rider: customer service is a plus" must not be READY at 0%
        expect(scoreJob(new Set(), pref('comm', 'excel'))).toBeNull()
    })
})

describe('rankJobs', () => {
    it('orders READY, then CLOSE, then STRETCH, then by score', () => {
        const has = new Set(['git', 'js'])
        const ranked = rankJobs(has, [
            job('stretch', req('a', 'b', 'c')),
            job('close', req('git', 'docker')),
            job('ready', [...req('git'), ...pref('js')]),
            job('empty', [])
        ])
        expect(ranked.map(r => r.job.id)).toEqual(['ready', 'close', 'stretch'])
    })

    it('ranks the match backed by more skills first when scores tie', () => {
        const has = new Set(['git', 'js', 'sql'])
        const ranked = rankJobs(has, [
            job('thin', req('git', 'js')),
            job('strong', req('git', 'js', 'sql'))
        ])
        expect(ranked.map(r => r.job.id)).toEqual(['strong', 'thin'])
    })
})

describe('nextBestSkills', () => {
    it('finds the skill that unlocks the most jobs, crediting its parents too', () => {
        const jobs = [
            job('j1', req('git', 'docker')),
            job('j2', req('git', 'docker')),
            job('j3', req('git', 'js')),       // learning React also satisfies JS
            job('j4', req('excel', 'comm', 'docker')),      // 3 missing -> 2 missing = STRETCH to CLOSE
            job('j5', req('excel', 'comm', 'docker', 'sql')) // 4 missing -> 3 missing = still STRETCH
        ]
        const best = nextBestSkills(['git'], jobs, ancestors)
        expect(best[0]).toEqual({ skillId: 'docker', newlyReady: 2, newlyClose: 1 })
        expect(best.find(b => b.skillId === 'js')).toEqual({ skillId: 'js', newlyReady: 1, newlyClose: 0 })
    })
})

describe('demandProfile and coverage', () => {
    const jobs = [
        job('a', [...req('sql', 'git'), ...pref('docker')]),
        job('b', req('sql')),
        job('c', [])
    ]

    it('counts share of postings, preferred at half weight, ignoring postings with no skills', () => {
        const { postings, profile } = demandProfile(jobs)
        expect(postings).toBe(2)
        expect(profile).toEqual([
            { skillId: 'sql', required: 2, preferred: 0, share: 1 },
            { skillId: 'git', required: 1, preferred: 0, share: 0.5 },
            { skillId: 'docker', required: 0, preferred: 1, share: 0.25 }
        ])
    })

    it('weights coverage by demand', () => {
        const { profile } = demandProfile(jobs)
        const c = coverage(new Set(['sql']), profile)
        // 1 / (1 + 0.5 + 0.25)
        expect(c.percent).toBe(57)
        expect(c.missing.map(m => m.skillId)).toEqual(['git', 'docker'])
    })
})

describe('recommendResources', () => {
    const gaps = [{ skillId: 'docker', share: 0.6 }, { skillId: 'git', share: 0.5 }, { skillId: 'excel', share: 0.1 }]

    it('picks a small set that covers the most important gaps without overlap', () => {
        const picked = recommendResources(gaps, [
            { id: 'devops', hours: 20, free: true, skillIds: ['docker', 'git'] },
            { id: 'docker-only', hours: 5, free: true, skillIds: ['docker'] },
            { id: 'office', hours: 8, free: true, skillIds: ['excel'] }
        ])
        expect(picked.map(p => p.id)).toEqual(['devops', 'office'])
        expect(picked[0].covers).toEqual(['docker', 'git'])
    })

    it('breaks ties with free, then shorter', () => {
        const picked = recommendResources([{ skillId: 'git', share: 1 }], [
            { id: 'paid', hours: 1, free: false, skillIds: ['git'] },
            { id: 'long', hours: 40, free: true, skillIds: ['git'] },
            { id: 'short', hours: 3, free: true, skillIds: ['git'] }
        ], 1)
        expect(picked[0].id).toBe('short')
    })
})
