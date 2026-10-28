import { api, ApiError, session } from './api.js'
import { toast, installTooltips, animateNumbers } from './ui.js'
import { connectLive } from './live.js'
import { installTheme, toggleTheme } from './theme.js'
import * as V from './views.js'

const state = {
    user: null,
    schools: null,
    occupations: [],
    authMode: 'login',
    regSchool: null,
    data: {},              // per-page server data
    matchFilter: {},
    gapOccupation: null,
    marketOccupation: '',
    programList: null,
    programId: null,
    detected: null,        // skills detected in the project draft
    projectDraft: null,
    skillResults: null,
    skillQuery: '',
    importDraft: null,
    lastImport: null,
    openJob: null,
    jobQuery: '',
    sourceType: null,
    regManual: false,       // sign-up: typing a school that is not listed
    jobCheckMode: 'link',
    jobCheckDraft: null,
    jobCheck: null,
    jobCheckBusy: false,
    coverLetter: null,
    coverLetterBusy: false,
    resumeDraft: null,
    resumeBusy: false,
    ai: { status: null, messages: [], pending: false },
    live: { connected: false, unread: 0, activity: [] }
}

let stopLive = null

const root = document.getElementById('app')
const PAGES = {
    profile: V.profile, matches: V.matches, alerts: V.alerts, jobcheck: V.jobcheck, resume: V.resume,
    gap: V.gap, assistant: V.assistant, market: V.market,
    programs: V.programs, ingest: V.ingest, jobs: V.jobs, taxonomy: V.taxonomy
}

const route = () => {
    const allowed = V.NAV[state.user.role].map(([id]) => id)
    const r = location.hash.replace(/^#\//, '')
    return allowed.includes(r) ? r : allowed[0]
}

const render = () => {
    if(!state.user){
        root.innerHTML = V.auth(state)
        return
    }
    const r = route()
    root.innerHTML = V.shell(state, r, PAGES[r](state))
    animateNumbers(root)
}

const renderPage = () => {
    const page = document.getElementById('page')
    if(!page) return render()
    page.innerHTML = PAGES[route()](state)
    animateNumbers(page)
}

// Only the sidebar links (badge, live dot), so a live event never wipes a form
const renderNav = () => {
    const links = document.getElementById('side-links')
    if(links) links.innerHTML = V.navLinks(state, route())
}

// ---------- live updates ----------

const startLive = () => {
    stopLive?.()
    stopLive = connectLive({
        status(connected){
            state.live.connected = connected
            renderNav()
            document.querySelectorAll('.live-inline').forEach(el => {
                el.classList.toggle('on', connected)
                el.lastChild.textContent = connected ? 'live' : 'reconnecting'
            })
        },
        hello({ unread }){
            state.live.unread = unread
            renderNav()
        },
        match(n){
            state.live.unread++
            renderNav()
            toast(`New ${n.status === 'READY' ? 'Ready' : 'Close'} match (${n.score}%): ${n.job.title} at ${n.job.company}`)
            if(route() === 'alerts') load('alerts')
        },
        activity(a){
            state.live.activity.unshift(a)
            state.live.activity.length = Math.min(state.live.activity.length, 20)
            const list = document.getElementById('live-activity')
            if(list) list.innerHTML = V.activityList(state.live.activity)
            if(a.kind === 'source-run' && route() === 'ingest') refreshSources()
        }
    })
}

// Update just the sources table (not the forms next to it)
const refreshSources = async () => {
    try{
        const res = await api('/job-sources')
        if(state.data.ingest){
            state.data.ingest.sources = res.data
            state.data.ingest.types = res.types
        }
        const table = document.getElementById('sources-table')
        if(table) table.innerHTML = V.sourcesTable(res.data)
    }catch(err){
        fail(err)
    }
}

const fail = (err) => {
    if(err instanceof ApiError && err.status === 401 && state.user){
        logout('Your session expired. Please log in again.')
        return
    }
    toast(err.message || 'Something went wrong', 'error')
}

// ---------- loaders: fetch what the page needs, then re-render it ----------

const loaders = {
    async profile(){
        const [skills, courses, certifications] = await Promise.all([
            api('/me/skills'),
            // A school typed at sign-up has no mapped courses
            state.user.programId ? api(`/programs/${state.user.programId}/courses`) : { data: [] },
            api('/certifications')
        ])
        state.data.profile = { skills, courses: courses.data, certifications: certifications.data }
    },
    async alerts(){
        state.data.alerts = await api('/me/notifications')
        // Opening the page reads them; the highlight stays until the next visit
        if(state.data.alerts.unread){
            await api('/me/notifications/read', { method: 'POST', body: {} })
            state.live.unread = 0
            renderNav()
        }
    },
    async jobcheck(){ /* nothing to load: the page starts with the form */ },
    async resume(){
        state.data.resume = await api('/me/resume')
    },
    async matches(){
        const q = new URLSearchParams({ limit: '50' })
        if(state.matchFilter.status) q.set('status', state.matchFilter.status)
        if(state.matchFilter.occupationId) q.set('occupationId', state.matchFilter.occupationId)
        state.data.matches = await api(`/me/matches?${q}`)
    },
    async gap(){
        const q = state.gapOccupation ? `?occupationId=${encodeURIComponent(state.gapOccupation)}` : ''
        state.data.gap = await api(`/me/gap-report${q}`)
    },
    async assistant(){
        state.ai.status ??= await api('/ai/status')
    },
    async market(){
        const q = state.marketOccupation ? `?occupationId=${encodeURIComponent(state.marketOccupation)}` : ''
        state.data.market = await api(`/market/skills${q}`)
    },
    async programs(){
        if(!state.programList){
            const schools = state.schools ?? (await api('/schools')).data
            state.programList = schools
                .filter(s => state.user.role === 'ADMIN' || s.id === state.user.schoolId)
                .flatMap(s => s.programs.map(p => ({ id: p.id, code: p.code, school: s.code })))
            state.programId ??= state.programList[0]?.id
        }
        if(state.user.role === 'ADMIN') state.data.unlisted = (await api('/schools/unlisted')).data
        if(state.programId) state.data.programs = await api(`/programs/${state.programId}/insights`)
    },
    async ingest(){
        const [imports, sources, reviews] = await Promise.all([api('/jobs/imports'), api('/job-sources'), api('/job-reviews')])
        state.ai.status ??= await api('/ai/status')
        state.data.ingest = { imports: imports.data, sources: sources.data, types: sources.types, reviews: reviews.data }
    },
    async jobs(){
        const q = state.jobQuery ? `&q=${encodeURIComponent(state.jobQuery)}` : ''
        state.data.jobs = (await api(`/jobs?limit=60${q}`)).data
    },
    async taxonomy(){
        state.data.taxonomy = (await api('/skills')).data
    }
}

const load = async (page = route()) => {
    try{
        await loaders[page]()
        if(route() === page) renderPage()
    }catch(err){
        fail(err)
    }
}

// ---------- session ----------

const startSession = async (token) => {
    session.set({ token })
    const me = await api('/me')
    state.user = me.data
    if(state.user.role === 'STUDENT') state.occupations = (await api('/occupations')).data
    state.data = {}
    render()
    load()
    // Career offices get nothing pushed, so they need no connection
    if(state.user.role !== 'SCHOOL_ADMIN') startLive()
}

const logout = (message) => {
    stopLive?.()
    stopLive = null
    state.live = { connected: false, unread: 0, activity: [] }
    session.clear()
    Object.assign(state, {
        user: null, data: {}, programList: null, programId: null, detected: null, projectDraft: null,
        skillResults: null, lastImport: null, openJob: null, gapOccupation: null, matchFilter: {},
        aiIntakeDraft: null, lastAiIntake: null, aiIntakeBusy: false,
        // Shared lab computers: the next student must not see this one's job check or resume
        jobCheck: null, jobCheckDraft: null, coverLetter: null, resumeDraft: null, regManual: false,
        ai: { status: null, messages: [], pending: false }
    })
    location.hash = ''
    render()
    if(message) toast(message)
}

// ---------- forms ----------

const values = (form) => Object.fromEntries(new FormData(form))

// Sends the conversation so far; the server keeps no chat history
const askAi = async (question) => {
    const ai = state.ai
    ai.messages.push({ role: 'user', content: question })
    ai.pending = true
    renderPage()
    scrollChat()
    try{
        const res = await api('/ai/chat', { method: 'POST', body: { messages: ai.messages } })
        ai.messages.push({ role: 'assistant', content: res.reply })
    }catch(err){
        ai.messages.pop() // let them retry the same question
        fail(err)
    }finally{
        ai.pending = false
        if(route() === 'assistant') renderPage()
        scrollChat()
    }
}

const scrollChat = () => {
    const log = document.getElementById('chat-log')
    if(log) log.scrollTop = log.scrollHeight
}

// The resume form has repeating entries named "edu.0.school", "exp.1.role"...
const readResumeForm = (form) => {
    const f = values(form)
    const rows = (prefix, fields) => {
        const out = []
        for(const [k, v] of Object.entries(f)){
            const m = k.match(new RegExp(`^${prefix}\\.(\\d+)\\.(\\w+)$`))
            if(m && fields.includes(m[2])) (out[m[1]] ??= {})[m[2]] = v
        }
        return out.filter(Boolean)
    }
    return {
        contact: { fullName: f.fullName, email: f.email, phone: f.phone, location: f.location, link: f.link },
        targetRole: f.targetRole,
        about: f.about,
        education: rows('edu', ['school', 'degree', 'years', 'details']),
        experience: rows('exp', ['role', 'organization', 'dates', 'description']),
        includeProjects: Boolean(form.querySelector('input[name=includeProjects]')?.checked)
    }
}

const forms = {
    async 'ai-chat'(form){
        const q = values(form).q.trim()
        if(q && !state.ai.pending) await askAi(q)
    },

    async login(form){
        const { email, password } = values(form)
        const res = await api('/auth/login', { method: 'POST', body: { email, password } })
        await startSession(res.accessToken)
    },

    async register(form){
        const { name, email, password, programId, schoolName, programName } = values(form)
        const body = state.regManual
            ? { name, email, password, schoolName, programName }
            : { name, email, password, programId }
        const res = await api('/auth/register', { method: 'POST', body })
        location.hash = '#/profile'
        await startSession(res.accessToken)
        toast('Welcome! Start by adding the courses you have taken.')
    },

    async courses(form){
        const courseIds = [...form.querySelectorAll('input[name=courseIds]:checked:not(:disabled)')].map(i => i.value)
        if(!courseIds.length) return toast('Tick the courses you have finished first.')
        const res = await api('/me/courses', { method: 'POST', body: { courseIds } })
        toast(`Added ${res.added} skill entries from ${courseIds.length} course(s)`)
        await load('profile')
    },

    async certification(form){
        const { certificationId } = values(form)
        if(!certificationId) return
        const res = await api('/me/certifications', { method: 'POST', body: { certificationId } })
        toast(`Certification added (${res.added} skills)`)
        await load('profile')
    },

    async 'skill-search'(form){
        state.skillQuery = values(form).q.trim()
        if(!state.skillQuery) return
        state.skillResults = (await api(`/skills?q=${encodeURIComponent(state.skillQuery)}`)).data
        renderPage()
    },

    async project(form, submitter){
        const { title, description } = values(form)
        state.projectDraft = { title, description }
        if(submitter?.dataset.intent === 'save'){
            const skillIds = [...form.querySelectorAll('input[name=skillIds]:checked')].map(i => i.value)
            if(!skillIds.length) return toast('Keep at least one skill checked.')
            await api('/me/projects', { method: 'POST', body: { title, description, skillIds } })
            toast(`Project saved with ${skillIds.length} skills`)
            state.detected = null
            state.projectDraft = null
            await load('profile')
            return
        }
        state.detected = (await api('/me/projects/extract', { method: 'POST', body: { description } })).data
        renderPage()
    },

    async 'ai-intake'(form){
        const { source, text } = values(form)
        state.aiIntakeDraft = { source, text }
        if(!text.trim()) return
        state.aiIntakeBusy = true
        renderPage()
        try{
            const res = await api('/jobs/ai-intake', { method: 'POST', body: { source, text } })
            state.lastAiIntake = res.data
            state.aiIntakeDraft = { source, text: '' }
            toast(`${res.data.published.length} published, ${res.data.flagged.length} held for review`)
        }finally{
            state.aiIntakeBusy = false
            renderPage() // keeps the pasted text if it failed, so it can be retried
        }
        await load('ingest')
    },

    async 'review-publish'(form){
        const fields = values(form)
        const res = await api(`/job-reviews/${encodeURIComponent(form.dataset.id)}/publish`, { method: 'POST', body: fields })
        toast(res.data.duplicate ? 'Already stored: marked as published' : `Published: ${fields.title}`)
        await load('ingest')
    },

    async import(form){
        const { source, format, data } = values(form)
        state.importDraft = { source, format, data }
        let payload = data
        if(format === 'json'){
            try{ payload = JSON.parse(data) }catch{ return toast('The data is not valid JSON', 'error') }
        }
        const res = await api('/jobs/import', { method: 'POST', body: { source, format, data: payload } })
        state.lastImport = res.data
        toast(`Imported: ${res.data.created} new, ${res.data.duplicates} duplicate`)
        await load('ingest')
    },

    async source(form){
        const f = values(form)
        const body = { name: f.name, type: f.type, intervalMinutes: Number(f.intervalMinutes) }
        if(f.type === 'JSON_FEED'){
            try{ body.fieldMap = JSON.parse(f.fieldMap || '{}') }catch{ return toast('Field map must be valid JSON', 'error') }
            body.url = f.url
            body.itemsPath = f.itemsPath || null
        }
        if(f.type === 'JOOBLE'){
            body.params = { keywords: f.keywords.split(',').map(k => k.trim()).filter(Boolean), location: f.location.trim() }
        }
        await api('/job-sources', { method: 'POST', body })
        toast(`${f.name} added. The scheduler pulls it within a minute.`)
        await load('ingest')
    },

    async jobcheck(form){
        const f = values(form)
        state.jobCheckDraft = { ...state.jobCheckDraft, ...f }
        const body = state.jobCheckMode === 'link' ? { url: f.url.trim() } : { text: f.text, title: f.title, company: f.company }
        state.jobCheckBusy = true
        state.coverLetter = null
        renderPage()
        try{
            state.jobCheck = await api('/me/job-check', { method: 'POST', body })
        }finally{
            state.jobCheckBusy = false
            renderPage()
        }
        document.querySelector('#page .card.section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },

    async resume(form){
        const input = readResumeForm(form)
        state.resumeDraft = input
        state.resumeBusy = true
        renderPage()
        try{
            state.data.resume = await api('/me/resume', { method: 'POST', body: { input } })
            state.resumeDraft = null
            const n = state.data.resume.suggestions?.jobs.length ?? 0
            toast(`Resume ready${state.data.resume.generatedBy === 'AI' ? ' (polished by AI)' : ''}. ${n ? `${n} jobs to apply to below.` : ''}`)
        }finally{
            state.resumeBusy = false
            renderPage()
        }
    },

    async 'job-search'(form){
        state.jobQuery = values(form).q.trim()
        await load('jobs')
    },

    async 'new-skill'(form){
        const { name, category, aliases, parentId } = values(form)
        await api('/skills', {
            method: 'POST',
            body: { name, category, aliases: aliases.split(',').map(a => a.trim()).filter(Boolean), parentId: parentId || null }
        })
        toast(`Added ${name}. Re-extract postings on the Ingestion page to apply it.`)
        await load('taxonomy')
    }
}

// ---------- buttons ----------

const actions = {
    logout: () => logout(),
    'toggle-theme': () => toggleTheme(),
    'jobcheck-mode'(el){
        const form = root.querySelector('form[data-form=jobcheck]')
        if(form) state.jobCheckDraft = { ...state.jobCheckDraft, ...values(form) }
        state.jobCheckMode = el.dataset.mode
        renderPage()
    },
    async 'cover-letter'(){
        const p = state.jobCheck?.posting
        if(!p) return
        state.coverLetterBusy = true
        renderPage()
        try{
            const res = await api('/me/cover-letter', {
                method: 'POST',
                body: { posting: { title: p.title, company: p.company, description: p.excerpt } }
            })
            state.coverLetter = res.letter
        }finally{
            state.coverLetterBusy = false
            renderPage()
        }
    },
    async 'copy-letter'(){
        const text = document.getElementById('cover-letter')?.value ?? ''
        try{
            await navigator.clipboard.writeText(text)
            toast('Cover letter copied')
        }catch{
            document.getElementById('cover-letter')?.select()
            toast('Press Ctrl+C to copy')
        }
    },
    'resume-add'(el){
        const form = root.querySelector('form[data-form=resume]')
        const input = form ? readResumeForm(form) : structuredClone(state.data.resume.input)
        const blank = el.dataset.list === 'education'
            ? { school: '', degree: '', years: '', details: '' }
            : { role: '', organization: '', dates: '', description: '' }
        const max = el.dataset.list === 'education' ? 4 : 6
        if(input[el.dataset.list].length >= max) return toast(`At most ${max} entries`)
        input[el.dataset.list].push(blank)
        state.resumeDraft = input
        renderPage()
    },
    'resume-remove'(el){
        const form = root.querySelector('form[data-form=resume]')
        const input = readResumeForm(form)
        input[el.dataset.list].splice(Number(el.dataset.index), 1)
        state.resumeDraft = input
        renderPage()
    },
    'print-resume': () => window.print(),
    async 'resume-add-skill'(el){
        await api('/me/skills', { method: 'POST', body: { skillId: el.dataset.id } })
        toast(`Added ${el.textContent.replace('+', '').trim()} to your profile`)
        el.remove()
    },
    'auth-mode'(el){
        state.authMode = el.dataset.mode
        render()
    },
    async 'remove-skill'(el){
        await api(`/me/skills/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' })
        await load('profile')
    },
    async 'remove-evidence'(el){
        if(!confirm(`Remove everything "${el.dataset.evidence}" added to your profile?`)) return
        await api('/me/evidence', { method: 'DELETE', body: { source: el.dataset.source, evidence: el.dataset.evidence } })
        await load('profile')
    },
    async 'add-skill'(el){
        await api('/me/skills', { method: 'POST', body: { skillId: el.dataset.id } })
        toast(`Added ${el.textContent.replace('+', '').trim()}`)
        await load('profile')
    },
    async 'match-status'(el){
        state.matchFilter.status = el.dataset.status || null
        await load('matches')
    },
    async 'run-source'(el){
        el.disabled = true
        el.textContent = 'Running…'
        try{
            const res = await api(`/job-sources/${encodeURIComponent(el.dataset.id)}/run`, { method: 'POST' })
            toast(`${res.data.source}: ${res.data.created} new, ${res.data.duplicates} already stored${res.data.heldForReview ? `, ${res.data.heldForReview} held for review` : ''}`)
            await load('ingest')
        }finally{
            el.disabled = false
            el.textContent = 'Run now'
        }
    },
    async 'toggle-source'(el){
        const enabled = el.dataset.enabled !== 'true'
        await api(`/job-sources/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: { enabled } })
        toast(enabled ? 'Source resumed' : 'Source paused')
        await refreshSources()
    },
    async reextract(el){
        el.disabled = true
        el.textContent = 'Re-extracting…'
        try{
            const res = await api('/jobs/reextract', { method: 'POST' })
            toast(`Re-extracted ${res.processed} postings`)
        }finally{
            el.disabled = false
            el.textContent = 'Re-extract all postings'
        }
    },
    async 'ai-suggest'(el){
        if(!state.ai.pending) await askAi(el.dataset.q)
    },
    'ai-clear'(){
        state.ai.messages = []
        renderPage()
    },
    async 'review-reject'(el){
        if(!confirm('Reject this posting? Students will not see it.')) return
        await api(`/job-reviews/${encodeURIComponent(el.dataset.id)}/reject`, { method: 'POST' })
        toast('Posting rejected')
        await load('ingest')
    },
    async 'open-job'(el){
        if(state.openJob?.id === el.dataset.id){
            state.openJob = null
        }else{
            state.openJob = (await api(`/jobs/${encodeURIComponent(el.dataset.id)}`)).data
        }
        renderPage()
    }
}

// ---------- select changes ----------

const changes = {
    'reg-manual'(el){
        const draft = values(el.closest('form'))
        state.regManual = el.checked
        render()
        const again = root.querySelector('form[data-form=register]')
        for(const k of ['name', 'email', 'password']) again.elements[k].value = draft[k] ?? ''
        again.querySelector(state.regManual ? 'input[name=schoolName]' : 'select[name=school]')?.focus()
    },
    'reg-school'(el){
        state.regSchool = el.value
        const form = el.closest('form')
        const draft = values(form)
        render()
        // keep what was typed
        const again = root.querySelector('form[data-form=register]')
        for(const k of ['name', 'email', 'password']) again.elements[k].value = draft[k] ?? ''
    },
    'match-occupation'(el){
        state.matchFilter.occupationId = el.value || null
        load('matches')
    },
    'gap-occupation'(el){
        state.gapOccupation = el.value
        load('gap')
    },
    'market-occupation'(el){
        state.marketOccupation = el.value
        load('market')
    },
    program(el){
        state.programId = el.value
        state.data.programs = null
        renderPage()
        load('programs')
    },
    'source-type'(el){
        state.sourceType = el.value
        renderPage()
    },
    'import-format'(el){
        const form = el.closest('form')
        state.importDraft = { ...values(form), format: el.value, data: V.SAMPLES[el.value] }
        renderPage()
    }
}

// ---------- wiring ----------

root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]')
    if(!form) return
    e.preventDefault()
    const buttons = form.querySelectorAll('button[type=submit]')
    buttons.forEach(b => { b.disabled = true })
    try{
        await forms[form.dataset.form]?.(form, e.submitter)
    }catch(err){
        fail(err)
    }finally{
        buttons.forEach(b => { b.disabled = false })
    }
})

root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]')
    if(!el || el.disabled) return
    e.preventDefault()
    try{
        await actions[el.dataset.action]?.(el)
    }catch(err){
        fail(err)
    }
})

root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]')
    if(el) changes[el.dataset.change]?.(el)
})

window.addEventListener('hashchange', () => {
    if(!state.user) return
    render()
    load()
})

const start = async () => {
    installTooltips()
    installTheme()
    try{
        state.schools = (await api('/schools')).data
        state.regSchool = state.schools[0]?.id
    }catch{ /* sign-up shows empty lists until the server is reachable */ }

    const saved = session.get()
    if(saved?.token){
        try{
            await startSession(saved.token)
            return
        }catch{
            session.clear()
        }
    }
    render()
}

start()
