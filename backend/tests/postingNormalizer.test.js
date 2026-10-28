import { describe, it, expect } from '@jest/globals'
import {
    parseCsv, stripHtml, mapFeedItem, normalizePosting, contentHash, buildClassifier, InvalidPosting
} from '../src/services/postingNormalizer.js'
import { isPrivateIp, assertPublicUrl } from '../src/utils/safeFetch.js'

describe('parseCsv', () => {
    it('handles quotes, escaped quotes, commas and newlines inside fields, CRLF and BOM', () => {
        const csv = '﻿Title,Company,Description\r\n"Web Dev","Acme, Inc.","Line 1\nSay ""hi"""\r\nQA,Beta,Test\r\n'
        expect(parseCsv(csv)).toEqual([
            { title: 'Web Dev', company: 'Acme, Inc.', description: 'Line 1\nSay "hi"' },
            { title: 'QA', company: 'Beta', description: 'Test' }
        ])
    })

    it('rejects an unclosed quote', () => {
        expect(() => parseCsv('a,b\n"oops,1')).toThrow(InvalidPosting)
    })
})

describe('stripHtml', () => {
    it('keeps list structure and drops tags and scripts', () => {
        expect(stripHtml('<p>We need:</p><ul><li>SQL</li><li>Git &amp; GitHub</li></ul><script>alert(1)</script>'))
            .toBe('We need:\n\n- SQL\n- Git & GitHub')
    })
})

describe('mapFeedItem', () => {
    it('reads nested paths from the field map', () => {
        const item = { id: 77, job_title: 'Analyst', org: { name: 'Acme' }, body: { html: '<b>SQL</b>' } }
        expect(mapFeedItem(item, { externalId: 'id', title: 'job_title', company: 'org.name', description: 'body.html' }))
            .toMatchObject({ externalId: 77, title: 'Analyst', company: 'Acme', description: '<b>SQL</b>' })
    })
})

describe('normalizePosting', () => {
    const now = new Date('2026-10-26T00:00:00Z')
    const base = { title: ' Junior Dev ', company: 'Acme', description: 'Needs SQL' }

    it('trims, defaults the date, accepts snake_case keys from CSV', () => {
        const p = normalizePosting({ ...base, external_id: 'X1' }, now)
        expect(p).toMatchObject({ title: 'Junior Dev', externalId: 'X1', postedAt: now, location: null })
    })

    it.each([
        [{ ...base, title: '' }, 'title is required'],
        [{ ...base, description: '<p></p>' }, 'description is required'],
        [{ ...base, url: 'javascript:alert(1)' }, 'url must start with'],
        [{ ...base, postedAt: 'yesterday-ish' }, 'postedAt is not a valid date'],
        [{ ...base, title: 'x'.repeat(201) }, 'title is longer than 200']
    ])('rejects bad input %#', (raw, message) => {
        expect(() => normalizePosting(raw, now)).toThrow(message)
    })

    it('clamps future dates to now', () => {
        expect(normalizePosting({ ...base, postedAt: '2030-01-01' }, now).postedAt).toEqual(now)
    })
})

describe('contentHash', () => {
    it('ignores case and spacing so a re-post is recognized', () => {
        expect(contentHash({ title: 'Junior  Dev', company: 'ACME', description: 'Needs\nSQL' }))
            .toBe(contentHash({ title: 'junior dev', company: 'acme', description: 'needs sql ' }))
    })
})

describe('buildClassifier', () => {
    const classify = buildClassifier([
        { id: 'analyst', titleKeywords: ['analyst'] },
        { id: 'data', titleKeywords: ['data analyst'] },
        { id: 'web', titleKeywords: ['web developer', 'frontend'] }
    ])

    it('picks the most specific keyword', () => {
        expect(classify('Junior Data Analyst')).toBe('data')
        expect(classify('Business Analyst')).toBe('analyst')
    })

    it('matches whole words only and returns null when unsure', () => {
        expect(classify('Frontend Engineer')).toBe('web')
        expect(classify('Frontendish Wizard')).toBeNull()
        expect(classify('Nurse')).toBeNull()
    })
})

describe('feed URL guard (SSRF)', () => {
    it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1'])(
        '%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true))

    it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1111'])('%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false))

    it('refuses internal and non-http URLs', async () => {
        await expect(assertPublicUrl('http://127.0.0.1:5432/')).rejects.toThrow('private network')
        await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('private network')
        await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('http or https')
        await expect(assertPublicUrl('http://localhost:4100/')).rejects.toThrow('private network')
    })
})
