// Reads a job posting out of a web page's HTML. Pure (no network), so it is unit-tested.
//
// 1. Structured data first: most career sites embed schema.org "JobPosting" JSON-LD
//    (it is what Google for Jobs reads), with clean title / company / description.
// 2. Otherwise the page's own text: title, site name and the visible text, without
//    scripts, styles, navigation and footers.
import { stripHtml } from './postingNormalizer.js'

const MAX_TEXT = 15000
const MIN_TEXT = 150 // less than this is a login wall or an app that renders with JavaScript

const decode = (s) => String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()

// "[Hiring] Software Engineer @Askable" -> "Software Engineer" (the company is shown separately)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cleanTitle = (title, company) => {
    let t = title.replace(/^\s*(\[\s*hiring\s*\]|hiring\s*[:!-])\s*/i, '')
    if(company) t = t.replace(new RegExp(`\\s*(@|\\bat\\b|-|\\|)\\s*${escapeRe(company)}\\s*$`, 'i'), '')
    return t.trim() || title
}

const isJobPosting = (node) => {
    const t = node?.['@type']
    return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
}

// JSON-LD can be one object, an array, or { "@graph": [...] }
const findJobPosting = (node, depth = 0) => {
    if(!node || typeof node !== 'object' || depth > 6) return null
    if(isJobPosting(node)) return node
    const children = Array.isArray(node) ? node : [node['@graph'], ...Object.values(node)]
    for(const child of children){
        const found = findJobPosting(child, depth + 1)
        if(found) return found
    }
    return null
}

const textOf = (v) => {
    if(!v) return ''
    if(typeof v === 'string') return v
    if(Array.isArray(v)) return v.map(textOf).filter(Boolean).join(', ')
    return v.name ?? ''
}

const locationOf = (jp) => {
    if(/telecommute|remote/i.test(String(jp.jobLocationType ?? ''))) return 'Remote'
    const places = [].concat(jp.jobLocation ?? [])
    const parts = places.map(p => {
        const a = p?.address ?? {}
        if(typeof a === 'string') return a
        return [a.addressLocality, a.addressRegion, textOf(a.addressCountry)].filter(Boolean).join(', ')
    }).filter(Boolean)
    return parts.join(' / ') || null
}

const fromStructuredData = (html) => {
    const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    for(const [, body] of scripts){
        let data
        try{ data = JSON.parse(body.trim()) }catch{ continue }
        const jp = findJobPosting(data)
        if(!jp?.title || !jp?.description) continue
        const company = decode(textOf(jp.hiringOrganization)) || null
        return {
            title: cleanTitle(decode(stripHtml(jp.title)), company),
            company,
            location: locationOf(jp),
            description: stripHtml(decode(jp.description)),
            datePosted: jp.datePosted ?? null,
            readFrom: 'structured-data'
        }
    }
    return null
}

const meta = (html, key) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i')
    const m = html.match(re)
    return m ? decode(m[1] ?? m[2]) : ''
}

const fromPageText = (html) => {
    const title = meta(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    const company = meta(html, 'og:site_name') || null
    const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html
    const text = stripHtml(main
        .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, ' '))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*/g, '\n')
        .trim()
        .slice(0, MAX_TEXT)
    return { title: title.slice(0, 200), company, location: null, description: text, datePosted: null, readFrom: 'page-text' }
}

// Returns { title, company, location, description, datePosted, readFrom } or null
const readJobPage = (html) => {
    const posting = fromStructuredData(html) ?? fromPageText(html)
    return posting.description.length >= MIN_TEXT ? posting : null
}

export { readJobPage, findJobPosting, MIN_TEXT }
