// One adapter per kind of source. Each turns the source's response into raw
// postings ({ externalId, title, company, location, description, url, postedAt })
// that go through the normal ingestion pipeline.
//
// Only sources whose owners allow automated access belong here. LinkedIn, Indeed
// and JobStreet forbid scraping in their terms, so they are deliberately absent.
import { fetchJson } from '../utils/safeFetch.js'
import { getPath, mapFeedItem } from './postingNormalizer.js'
import { BadRequest } from '../utils/errorClass.js'

const HOUR = 60 * 60 * 1000

// ---------- Remotive (https://github.com/remotive-com/remote-jobs-api) ----------
// Terms: at most ~4 requests a day, link back to Remotive and credit it on every
// job, show jobs 24 h after publication, do not use them to collect sign-ups.
const REMOTIVE_URL = 'https://remotive.com/api/remote-jobs'

// Remote jobs a person in the Philippines can actually apply for
const OPEN_TO_PH = /\b(worldwide|anywhere|global|philippines|apac|asia|southeast asia|sea)\b/i

const remotiveOpenToPh = (job) => OPEN_TO_PH.test(job?.candidate_required_location || 'Worldwide')

// Remotive dates have no timezone ("2026-10-22T18:40:19"); they are UTC
const utc = (value) => {
    if(!value) return undefined
    return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
}

const mapRemotive = (job) => ({
    externalId: String(job.id),
    title: job.title,
    company: job.company_name,
    location: `Remote (${job.candidate_required_location || 'Worldwide'})`,
    description: job.description,
    url: job.url, // the job's page on Remotive: the required link-back
    postedAt: utc(job.publication_date)
})

// ---------- Jooble (https://jooble.org/api/about) ----------
// Free key on request. Request/response format per Jooble's code samples:
// POST https://jooble.org/api/{key}  { keywords, location, page } -> { jobs: [...] }
// Verify the fields with a real key before relying on this adapter.
const mapJooble = (job) => ({
    externalId: job.id != null ? String(job.id) : undefined,
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.snippet,
    url: job.link,
    postedAt: job.updated
})

const ADAPTERS = {
    JSON_FEED: {
        label: 'Partner JSON feed',
        minIntervalMinutes: 15,
        delayHours: 0,
        async fetch(source){
            if(!source.url) throw new BadRequest('This feed has no URL')
            const body = await fetchJson(source.url)
            const items = source.itemsPath ? getPath(body, source.itemsPath) : body
            if(!Array.isArray(items)) throw new BadRequest(`Feed did not contain an array${source.itemsPath ? ` at "${source.itemsPath}"` : ''}`)
            return items.map(item => mapFeedItem(item, source.fieldMap))
        }
    },

    REMOTIVE: {
        label: 'Remotive (remote jobs)',
        minIntervalMinutes: 360, // 4 a day at most
        delayHours: 24,
        attribution: { name: 'Remotive', url: 'https://remotive.com' },
        async fetch(source){
            const p = source.params ?? {}
            const q = new URLSearchParams({ limit: String(Math.min(Number(p.limit) || 200, 500)) })
            if(p.category) q.set('category', String(p.category))
            if(p.search) q.set('search', String(p.search))
            const body = await fetchJson(`${REMOTIVE_URL}?${q}`)
            if(!Array.isArray(body?.jobs)) throw new BadRequest('Remotive did not return a job list')
            return body.jobs.filter(remotiveOpenToPh).map(mapRemotive)
        }
    },

    JOOBLE: {
        label: 'Jooble (job search engine)',
        minIntervalMinutes: 60,
        delayHours: 0,
        async fetch(source){
            const key = process.env.JOOBLE_API_KEY
            if(!key) throw new BadRequest('Set JOOBLE_API_KEY in .env (request a free key at jooble.org/api/about)')
            const p = source.params ?? {}
            const keywords = Array.isArray(p.keywords) && p.keywords.length ? p.keywords : ['']
            const location = typeof p.location === 'string' ? p.location : 'Philippines'

            const out = []
            for(const kw of keywords.slice(0, 10)){
                const body = await fetchJson(`https://jooble.org/api/${encodeURIComponent(key)}`, {
                    body: { keywords: String(kw), location, page: 1 }
                })
                if(!Array.isArray(body?.jobs)) throw new BadRequest('Jooble did not return a job list')
                out.push(...body.jobs.map(mapJooble))
            }
            return out
        }
    }
}

const adapterFor = (type) => {
    const adapter = ADAPTERS[type]
    if(!adapter) throw new BadRequest(`Unknown source type ${type}`)
    return adapter
}

// When students may first see a posting from this source
const visibleAtFor = (type, postedAt, now = new Date()) => {
    const delay = adapterFor(type).delayHours * HOUR
    if(!delay) return now
    const t = new Date(postedAt).getTime() + delay
    return Number.isNaN(t) || t < now.getTime() ? now : new Date(t)
}

export { ADAPTERS, adapterFor, visibleAtFor, mapRemotive, remotiveOpenToPh, mapJooble, REMOTIVE_URL }
