import { createHash } from 'crypto'

const LIMITS = { title: 200, company: 200, location: 200, description: 20000, url: 2000, externalId: 200 }

class InvalidPosting extends Error {}

// RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes.
// Returns an array of objects keyed by the (trimmed, lower-cased) header row.
const parseCsv = (text) => {
    const rows = []
    let row = [], field = '', inQuotes = false
    const src = String(text ?? '').replace(/^﻿/, '') // Excel adds a BOM

    for(let i = 0; i < src.length; i++){
        const c = src[i]
        if(inQuotes){
            if(c === '"' && src[i + 1] === '"'){ field += '"'; i++ }
            else if(c === '"') inQuotes = false
            else field += c
        }else if(c === '"' && field === ''){
            inQuotes = true
        }else if(c === ','){
            row.push(field); field = ''
        }else if(c === '\n' || c === '\r'){
            if(c === '\r' && src[i + 1] === '\n') i++
            row.push(field); field = ''
            if(row.some(f => f !== '')) rows.push(row)
            row = []
        }else{
            field += c
        }
    }
    if(inQuotes) throw new InvalidPosting('CSV has an unclosed quote')
    row.push(field)
    if(row.some(f => f !== '')) rows.push(row)

    if(!rows.length) return []
    const header = rows[0].map(h => h.trim().toLowerCase())
    return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

// Feeds often send HTML descriptions; keep the line structure, drop the tags
const stripHtml = (html) => String(html ?? '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*li\s*>/gi, '') // the opening <li> already started a new line
    .replace(/<\s*\/\s*(p|div|ul|ol|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// "data.jobs[0].title" style lookup for feed field maps
const getPath = (obj, path) => {
    if(!path) return undefined
    return String(path).split('.').reduce((cur, key) => {
        if(cur == null) return undefined
        const m = key.match(/^(\w+)\[(\d+)\]$/)
        return m ? cur[m[1]]?.[Number(m[2])] : cur[key]
    }, obj)
}

const FIELDS = ['title', 'company', 'location', 'description', 'url', 'postedAt', 'externalId']

// Feed item -> raw posting, using { field: "path.in.item" }; unmapped fields use their own name
const mapFeedItem = (item, fieldMap = {}) =>
    Object.fromEntries(FIELDS.map(f => [f, fieldMap[f] ? getPath(item, fieldMap[f]) : item?.[f]]))

const text = (value, field, { required = false } = {}) => {
    const v = value == null ? '' : String(value).trim()
    if(required && !v) throw new InvalidPosting(`${field} is required`)
    if(v.length > LIMITS[field]) throw new InvalidPosting(`${field} is longer than ${LIMITS[field]} characters`)
    return v || null
}

// Raw object from CSV / JSON / feed -> clean posting, or throws InvalidPosting
const normalizePosting = (raw, now = new Date()) => {
    if(!raw || typeof raw !== 'object') throw new InvalidPosting('posting must be an object')

    // CSV headers arrive lower-cased
    const pick = (name) => raw[name] ?? raw[name.toLowerCase()] ?? raw[name.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]

    const description = stripHtml(pick('description'))
    const posting = {
        title: text(stripHtml(pick('title')), 'title', { required: true }),
        company: text(pick('company'), 'company', { required: true }),
        location: text(pick('location'), 'location'),
        description: text(description, 'description', { required: true }),
        url: text(pick('url'), 'url'),
        externalId: text(pick('externalId'), 'externalId'),
        postedAt: now
    }

    if(posting.url && !/^https?:\/\//i.test(posting.url)) throw new InvalidPosting('url must start with http:// or https://')

    const postedAt = pick('postedAt')
    if(postedAt){
        const d = new Date(postedAt)
        if(Number.isNaN(d.getTime())) throw new InvalidPosting('postedAt is not a valid date')
        // A date in the future is a typo or a timezone mistake; clamp it
        posting.postedAt = d > now ? now : d
    }
    return posting
}

// Same job re-posted through another channel should be recognized, so the
// hash ignores source, URL and date, and is insensitive to case and spacing
const contentHash = ({ title, company, description }) => {
    const squash = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    return createHash('sha256').update(`${squash(title)}|${squash(company)}|${squash(description)}`).digest('hex')
}

// occupations: [{ id, titleKeywords: [] }]. Most specific keyword wins ("data analyst" beats "analyst").
const buildClassifier = (occupations) => {
    const rules = []
    for(const o of occupations){
        for(const k of o.titleKeywords ?? []){
            const kw = k.toLowerCase().trim()
            if(kw) rules.push({ occupationId: o.id, kw, re: new RegExp(`(?<![a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`) })
        }
    }
    rules.sort((a, b) => b.kw.length - a.kw.length)
    return (title) => {
        const t = String(title ?? '').toLowerCase()
        return rules.find(r => r.re.test(t))?.occupationId ?? null
    }
}

export { InvalidPosting, parseCsv, stripHtml, getPath, mapFeedItem, normalizePosting, contentHash, buildClassifier }
