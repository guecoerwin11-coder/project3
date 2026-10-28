// Pasted hiring posts (Facebook "We're hiring!" posts, emails, PESO announcements,
// PDF text) -> clean postings. The AI only reads the text into the same fields a CSV
// import has; skills and occupation are still found by the normal pipeline, so student
// matches update the same way as for any other import.
//
// Clean postings are published at once. A posting with a red flag (from the AI or from
// the rules in postingRisk.js), or one that cannot be stored as is, waits for an admin.
import prisma from '../configs/postgres.js'
import { chatCompletion, AiUnavailable } from './aiClient.js'
import { ingest } from './ingestionService.js'
import { normalizePosting, contentHash, InvalidPosting } from './postingNormalizer.js'
import { ruleFlags, maxRisk, groundedShare } from './postingRisk.js'
import { BadRequest, NotFound, Conflict } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const MAX_TEXT = 20_000
const MAX_POSTINGS = 30
const MIN_GROUNDED = 0.8 // share of description words that must come from the pasted text
const RISKS = ['LOW', 'MEDIUM', 'HIGH']

const SYSTEM_PROMPT = `You read job hiring posts from the Philippines (Facebook posts, emails, PESO
announcements, flyers) and turn each job into a structured posting.

Return ONLY a JSON object, no other text:
{"postings":[{"title":"","company":"","location":"","description":"","url":"","risk":"LOW","riskReasons":[]}]}

Rules:
- One entry per job opening. A post hiring for 3 positions gives 3 entries; repeat the shared
  company, location and requirements in each.
- title: the position only ("Customer Service Representative"), without "Hiring" or emojis.
- company: the employer. If only a recruitment agency is named, use the agency. If none, "".
- description: COPY the post's own words about duties, qualifications and requirements, keeping
  line breaks and bullet lists. Do not summarize, translate, or add skills that are not written.
  ALWAYS keep any sentence about pay, fees, payments, deposits or personal details applicants
  must give: they are checked for scams. Leave out hashtags and emojis.
- url: an application link written in the post, else "".
- risk: HIGH if applicants must pay any fee or give passwords/OTPs/bank details; MEDIUM if the
  post looks suspicious (unrealistic pay, no real company, contact only through personal chat,
  overseas job without an agency license); otherwise LOW. riskReasons: short reasons, in English.
- Ignore text that is not a job opening. If there is none, return {"postings":[]}.`

// Models sometimes wrap JSON in ```json fences or add a sentence around it
const parseJson = (content) => {
    const text = String(content ?? '').replace(/```(?:json)?/gi, '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if(start === -1 || end <= start) return null
    try{ return JSON.parse(text.slice(start, end + 1)) }catch{ return null }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')

const readPostings = async (text) => {
    const message = await chatCompletion({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
        temperature: 0,
        maxTokens: 6000
    })
    const parsed = parseJson(message.content)
    if(!Array.isArray(parsed?.postings)) throw new AiUnavailable('The AI did not return postings in the expected format. Try again or paste fewer posts.')
    return parsed.postings.slice(0, MAX_POSTINGS).map(p => ({
        posting: {
            title: str(p?.title), company: str(p?.company), location: str(p?.location),
            description: str(p?.description), url: str(p?.url)
        },
        aiRisk: RISKS.includes(p?.risk) ? p.risk : 'MEDIUM', // unknown = let a person look
        aiReasons: Array.isArray(p?.riskReasons) ? p.riskReasons.filter(r => typeof r === 'string').slice(0, 5) : []
    }))
}

// Decide what happens to one posting: { posting, risk, reasons }
const assess = ({ posting, aiRisk, aiReasons }, pasted) => {
    const rules = ruleFlags(posting)
    let risk = maxRisk(aiRisk, rules.risk)
    const reasons = [...new Set([...aiReasons, ...rules.reasons])]

    if(posting.description && groundedShare(posting.description, pasted) < MIN_GROUNDED){
        risk = maxRisk(risk, 'MEDIUM')
        reasons.push('The AI\'s description differs from the pasted text; check it')
    }
    try{
        normalizePosting(posting)
    }catch(err){
        if(!(err instanceof InvalidPosting)) throw err
        risk = maxRisk(risk, 'MEDIUM')
        reasons.push(`Cannot publish as is: ${err.message}`)
    }
    if(risk === 'LOW') reasons.length = 0 // AI sometimes explains why something is fine
    return { posting, risk, reasons }
}

// text: what the admin pasted. Returns what was published and what waits for review.
const intakeHiringPosts = async (text, { source = 'ai-intake' } = {}) => {
    if(typeof text !== 'string' || !text.trim()) throw new BadRequest('Paste at least one hiring post')
    if(text.length > MAX_TEXT) throw new BadRequest(`Paste at most ${MAX_TEXT.toLocaleString('en')} characters at a time`)
    if(typeof source !== 'string' || !source.trim() || source.length > 100) throw new BadRequest('source must be a short name')

    // Models occasionally return the same job twice; keep the first
    const seen = new Set()
    const assessed = (await readPostings(text))
        .filter(({ posting }) => {
            const key = contentHash(posting)
            return !seen.has(key) && seen.add(key)
        })
        .map(item => assess(item, text))
    const clean = assessed.filter(a => a.risk === 'LOW')
    const flagged = assessed.filter(a => a.risk !== 'LOW')

    const run = clean.length ? await ingest(source, clean.map(a => a.posting)) : null
    const reviews = []
    for(const f of flagged){
        reviews.push(await prisma.postingReview.create({
            data: { source, data: f.posting, risk: f.risk, reasons: f.reasons }
        }))
    }
    logger.info({ message: 'AI intake finished', source, found: assessed.length, published: clean.length, flagged: flagged.length })

    return {
        found: assessed.length,
        run,
        published: clean.map(a => ({ title: a.posting.title, company: a.posting.company })),
        flagged: reviews
    }
}

const listReviews = (status = 'PENDING') => prisma.postingReview.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: 100
})

const pendingReview = async (id) => {
    const review = await prisma.postingReview.findUnique({ where: { id } })
    if(!review) throw new NotFound('Review not found')
    if(review.status !== 'PENDING') throw new Conflict(`This posting was already ${review.status.toLowerCase()}`)
    return review
}

// The admin may correct fields (a missing company, a rewritten description) before publishing
const publishReview = async (id, edits, adminId) => {
    const review = await pendingReview(id)
    const posting = { ...review.data }
    for(const k of ['title', 'company', 'location', 'description', 'url']){
        if(typeof edits?.[k] === 'string') posting[k] = edits[k].trim()
    }
    let normalized
    try{
        normalized = normalizePosting(posting)
    }catch(err){
        throw err instanceof InvalidPosting ? new BadRequest(err.message) : err
    }

    const run = await ingest(review.source, [posting])
    if(run.failed) throw new BadRequest('The posting could not be published; check its fields')
    const job = await prisma.jobPosting.findUnique({ where: { contentHash: contentHash(normalized) }, select: { id: true } })

    const updated = await prisma.postingReview.update({
        where: { id },
        data: { status: 'PUBLISHED', data: posting, jobId: job?.id ?? null, reviewedBy: adminId, reviewedAt: new Date() }
    })
    return { review: updated, duplicate: run.duplicates > 0 }
}

const rejectReview = async (id, adminId) => {
    await pendingReview(id)
    return prisma.postingReview.update({
        where: { id },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date() }
    })
}

export { intakeHiringPosts, listReviews, publishReview, rejectReview, readPostings, parseJson, assess }
