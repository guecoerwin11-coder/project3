import dns from 'dns/promises'
import net from 'net'
import { BadRequest } from './errorClass.js'

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15000

// Private, loopback, link-local and other non-public ranges
const isPrivateIp = (ip) => {
    if(net.isIPv4(ip)){
        const [a, b] = ip.split('.').map(Number)
        return a === 10 || a === 127 || a === 0 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            a >= 224
    }
    const v6 = ip.toLowerCase()
    if(v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7))
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

// The feed URL is typed by an admin, but a server that fetches arbitrary URLs can be
// pointed at internal services (SSRF). Only public http(s) hosts are allowed.
const assertPublicUrl = async (raw) => {
    let url
    try{ url = new URL(raw) }catch{ throw new BadRequest('Invalid feed URL') }
    if(!['http:', 'https:'].includes(url.protocol)) throw new BadRequest('Feed URL must be http or https')

    const host = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => [])
    if(!addresses.length) throw new BadRequest(`Cannot resolve ${host}`)
    if(addresses.some(a => isPrivateIp(a.address))) throw new BadRequest('Feed URL points to a private network address')
    return url
}

// Fetches JSON with a timeout and a size cap; redirects are refused so they
// cannot bounce the request to an internal address.
// `body` (an object) turns it into a JSON POST, for APIs such as Jooble.
const fetchJson = async (raw, { body } = {}) => {
    const url = await assertPublicUrl(raw)
    let res
    try{
        res = await fetch(url, {
            method: body ? 'POST' : 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: {
                Accept: 'application/json',
                'User-Agent': 'SkillBridge-Ingest/1.0',
                ...(body && { 'Content-Type': 'application/json' })
            },
            body: body ? JSON.stringify(body) : undefined
        })
    }catch(err){
        throw new BadRequest(`Could not fetch feed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`)
    }
    // Never echo the URL: API keys can live in it (Jooble)
    if(!res.ok) throw new BadRequest(`Feed responded with HTTP ${res.status}`)

    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    for(;;){
        const { done, value } = await reader.read()
        if(done) break
        size += value.length
        if(size > MAX_BYTES){
            await reader.cancel()
            throw new BadRequest('Feed is larger than 5 MB')
        }
        chunks.push(value)
    }
    try{
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }catch{
        throw new BadRequest('Feed did not return valid JSON')
    }
}

const MAX_REDIRECTS = 5
const PAGE_MAX_BYTES = 3 * 1024 * 1024

// Fetches a web page a student pasted (one page, on their behalf, like a browser would).
// Job links usually redirect (http -> https, tracking links), so redirects are followed
// by hand and EVERY hop is checked again, so a redirect cannot reach a private address.
// Returns { html, finalUrl }.
const fetchPage = async (raw) => {
    let url = await assertPublicUrl(raw)
    for(let hop = 0; hop <= MAX_REDIRECTS; hop++){
        let res
        try{
            res = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'User-Agent': 'Mozilla/5.0 (compatible; SkillBridge job-link reader)',
                    'Accept-Language': 'en-PH,en;q=0.9'
                }
            })
        }catch(err){
            throw new BadRequest(err.name === 'TimeoutError' ? 'The job page took too long to answer' : 'Could not open that link')
        }

        if(res.status >= 300 && res.status < 400 && res.headers.get('location')){
            url = await assertPublicUrl(new URL(res.headers.get('location'), url).href)
            continue
        }
        if(res.status === 401 || res.status === 403 || res.status === 999){
            throw new BadRequest('That site does not let other apps read its pages (it may need a login). Paste the job description instead.')
        }
        if(!res.ok) throw new BadRequest(`The job page answered with HTTP ${res.status}`)
        const type = res.headers.get('content-type') ?? ''
        if(!/html|xml|text\/plain/i.test(type)) throw new BadRequest('That link is not a web page')

        const reader = res.body.getReader()
        const chunks = []
        let size = 0
        for(;;){
            const { done, value } = await reader.read()
            if(done) break
            size += value.length
            if(size > PAGE_MAX_BYTES){
                await reader.cancel()
                break // the job details are near the top; keep what we have
            }
            chunks.push(value)
        }
        return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.href }
    }
    throw new BadRequest('That link redirects too many times')
}

export { isPrivateIp, assertPublicUrl, fetchJson, fetchPage }
