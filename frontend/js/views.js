// Render functions: data in, HTML out. All server text goes through esc().
import {
    esc, pct, fmtNum, fmtDate, fmtTime, plural, statusLabel, meter, bars, tile, chips, LOGO
} from './ui.js'
import { themeToggle } from './theme.js'

const SOURCE_LABEL = { COURSE: 'Course', CERTIFICATE: 'Certificate', PROJECT: 'Project', SELF: 'Self-declared' }
const ROLE_LABEL = { STUDENT: 'Student', SCHOOL_ADMIN: 'Career office', ADMIN: 'Platform admin' }

export const NAV = {
    STUDENT: [['profile', 'My skills'], ['matches', 'Job matches'], ['alerts', 'Job alerts'], ['jobcheck', 'Check a job link'],
        ['resume', 'Resume maker'], ['interview', 'Mock interview'], ['gap', 'Gap report'], ['assistant', 'AI assistant'], ['market', 'Job market']],
    SCHOOL_ADMIN: [['programs', 'Program insights'], ['market', 'Job market']],
    ADMIN: [['ingest', 'Ingestion'], ['jobs', 'Postings'], ['taxonomy', 'Skills taxonomy'], ['programs', 'Program insights'], ['market', 'Job market']]
}

// Re-rendered on its own when a live event arrives, so open forms are left alone
export const navLinks = (state, route) => `
    ${NAV[state.user.role].map(([id, label]) => `
        <a href="#/${id}" class="${route === id ? 'active' : ''}">${esc(label)}${id === 'alerts' && state.live.unread
            ? ` <span class="count" aria-label="${state.live.unread} unread">${state.live.unread > 99 ? '99+' : state.live.unread}</span>` : ''}</a>`).join('')}
    ${state.user.role === 'SCHOOL_ADMIN' ? '' /* nothing is pushed to career offices */ : `
    <div class="live ${state.live.connected ? 'on' : ''}" data-tip="${state.live.connected ? 'New jobs and alerts arrive instantly' : 'Reconnecting… alerts will catch up'}">
        <span class="dot"></span>${state.live.connected ? 'Live' : 'Offline'}
    </div>`}`

export const shell = (state, route, body) => `
    <div class="shell">
        <nav class="side" aria-label="Main">
            <div class="brand">${LOGO}<span>SkillBridge</span></div>
            <div id="side-links" class="side-links">${navLinks(state, route)}</div>
            <div class="who">
                <div class="name">${esc(state.user.name)}</div>
                <div class="role">${esc(ROLE_LABEL[state.user.role])}${state.user.program ? ` · ${esc(state.user.program.code)}` : ''}${state.user.school ? `<br>${esc(state.user.school.name)}` : ''}</div>
                ${themeToggle()}
                <button class="small" data-action="logout">Log out</button>
            </div>
        </nav>
        <main id="page">${body}</main>
    </div>`

export const loading = (title) => `<h1>${esc(title)}</h1><p class="sub">Loading…</p>`

// ---------------------------------------------------------------- auth

export const auth = (state) => {
    const registering = state.authMode === 'register'
    const schools = state.schools ?? []
    const school = schools.find(s => s.id === state.regSchool) ?? schools[0]
    return `
    <div class="auth-theme">${themeToggle('on-page')}</div>
    <div class="auth">
        <div class="brand">${LOGO}<span>SkillBridge</span></div>
        <p class="tagline">See how close your skills are to real jobs, and what to learn next.</p>
        <div class="tabs">
            <button class="${registering ? '' : 'on'}" data-action="auth-mode" data-mode="login">Log in</button>
            <button class="${registering ? 'on' : ''}" data-action="auth-mode" data-mode="register">I'm a student, sign me up</button>
        </div>
        <div class="card">
        ${registering ? `
            <form class="stack" data-form="register">
                <label>Full name <input name="name" required autocomplete="name"></label>
                <label>Email <input name="email" type="email" required autocomplete="email"></label>
                <label>Password <span class="hint">At least 8 characters</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
                ${state.regManual ? `
                <label>School <input name="schoolName" required minlength="2" maxlength="120" placeholder="e.g. Bulacan State University" autocomplete="organization"></label>
                <label>Program / course <input name="programName" required minlength="2" maxlength="120" placeholder="e.g. BS Computer Science"></label>
                <p class="hint">You can still add certificates, projects and skills, and build your resume.
                    Course-by-course skills appear once your school joins SkillBridge.</p>` : `
                <label>School
                    <select name="school" data-change="reg-school">
                        ${schools.map(s => `<option value="${esc(s.id)}" ${s.id === school?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                    </select>
                </label>
                <label>Program
                    <select name="programId" required>
                        ${(school?.programs ?? []).map(p => `<option value="${esc(p.id)}">${esc(p.code)} · ${esc(p.name)}</option>`).join('')}
                    </select>
                </label>`}
                <label class="check manual-school">
                    <input type="checkbox" data-change="reg-manual" ${state.regManual ? 'checked' : ''}>
                    <span>My school isn't on the list, I'll type it</span>
                </label>
                <button class="primary" type="submit">Create account</button>
            </form>` : `
            <form class="stack" data-form="login">
                <label>Email <input name="email" type="email" required autocomplete="username"></label>
                <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
                <button class="primary" type="submit">Log in</button>
            </form>`}
        </div>
        <div class="demo">
            Demo accounts, password <code>skillbridge123</code><br>
            Students: <code>ana@student.local</code> <code>franco@student.local</code> <code>kevin@student.local</code><br>
            Career office: <code>career@psi.edu.local</code> <code>career@sipc.edu.local</code><br>
            Admin: <code>admin@skillbridge.local</code>
        </div>
    </div>`
}

// ---------------------------------------------------------------- student: profile

export const profile = (state) => {
    const d = state.data.profile
    if(!d) return loading('My skills')
    const { skills, courses, certifications } = d
    const count = (src) => new Set(skills.groups.filter(g => g.source === src).flatMap(g => g.skills.map(s => s.id))).size
    const takenCourses = new Set(skills.groups.filter(g => g.source === 'COURSE').map(g => g.evidence))
    const heldCerts = new Set(skills.groups.filter(g => g.source === 'CERTIFICATE').map(g => g.evidence))
    const detected = state.detected

    return `
    <h1>My skills</h1>
    <p class="sub">Everything here is compared with real job postings. The more evidence you add, the better your matches.</p>
    <div class="grid tiles">
        ${tile('Skills on your profile', fmtNum(skills.totalSkills))}
        ${tile('From courses', fmtNum(count('COURSE')))}
        ${tile('From certificates', fmtNum(count('CERTIFICATE')))}
        ${tile('From projects', fmtNum(count('PROJECT')))}
    </div>

    <div class="card section">
        <h2>Your skills and where they come from</h2>
        <p class="hint">Remove anything that isn't true for you.</p>
        ${skills.groups.length ? skills.groups.map(g => `
            <div class="chip-label">
                ${esc(SOURCE_LABEL[g.source])}${g.evidence ? `: ${esc(g.evidence)}` : ''}
                ${g.source !== 'SELF' ? ` · <button class="link small" data-action="remove-evidence" data-source="${esc(g.source)}" data-evidence="${esc(g.evidence)}">remove</button>` : ''}
            </div>
            <div class="chips">${g.skills.map(s => `
                <span class="chip">${esc(s.name)}<button aria-label="Remove ${esc(s.name)}" data-action="remove-skill" data-id="${esc(s.rowId)}">×</button></span>`).join('')}
            </div>`).join('') : ''}
        ${skills.customSkills?.length ? `
            <div class="chip-label">Your own skills</div>
            <div class="chips">${skills.customSkills.map(s => `
                <span class="chip custom">${esc(s.name)}<button aria-label="Remove ${esc(s.name)}" data-action="remove-custom-skill" data-id="${esc(s.id)}">×</button></span>`).join('')}
            </div>
            <p class="hint">These show on your profile and resume. Job matching can count them once SkillBridge adds them to its skill list.</p>` : ''}
        ${!skills.groups.length && !skills.customSkills?.length ? '<div class="empty">No skills yet. Start with the courses you have taken, your certificates or a project below.</div>' : ''}
    </div>

    <div class="grid two section">
        <div class="card">
            <h2>Courses you've taken</h2>
            ${!state.user.programId ? `
            <p class="hint">${esc(state.user.school?.name ?? 'Your school')} is not on SkillBridge yet, so its courses are not mapped to skills.</p>
            <div class="notice">Add your skills through <strong>certifications</strong>, <strong>projects</strong> and <strong>Add a skill yourself</strong>.
                The <a href="#/resume">Resume maker</a> also picks up skills from your work experience.</div>` : `
            <p class="hint">Your school mapped each course to the skills it teaches.</p>
            <form data-form="courses">
                <div class="checks">${courses.map(c => `
                    <label class="check" data-tip="${esc(c.skills.map(s => s.name).join(', ') || 'No skills mapped')}">
                        <input type="checkbox" name="courseIds" value="${esc(c.id)}" ${takenCourses.has(c.code) ? 'checked disabled' : ''}>
                        <span><strong>${esc(c.code)}</strong> ${esc(c.title)}</span>
                    </label>`).join('')}
                </div>
                <div style="margin-top:12px"><button class="primary" type="submit">Add selected courses</button></div>
            </form>`}
        </div>

        <div class="card">
            <h2>Certifications</h2>
            <p class="hint">TESDA National Certificates and others prove skills employers trust.</p>
            <form class="inline" data-form="certification">
                <label>Certification
                    <select name="certificationId">
                        ${certifications.filter(c => !heldCerts.has(c.name)).map(c =>
                            `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.issuer)})</option>`).join('')}
                    </select>
                </label>
                <button class="primary" type="submit">Add</button>
            </form>

            <h2 class="section">Add a skill yourself</h2>
            <form class="inline" data-form="skill-search">
                <label>Search skills <input name="q" placeholder="e.g. Excel, React, customer service" value="${esc(state.skillQuery ?? '')}"></label>
                <button type="submit">Search</button>
            </form>
            ${state.skillResults ? `<div class="chips" style="margin-top:10px">${state.skillResults.length
                ? state.skillResults.slice(0, 20).map(s => `<button class="chip plain" data-action="add-skill" data-id="${esc(s.id)}">+ ${esc(s.name)}</button>`).join('')
                : '<span class="hint">SkillBridge doesn\'t have that skill in its list yet.</span>'}</div>
            ${state.skillQuery && !state.skillResults.some(s => s.name.toLowerCase() === state.skillQuery.toLowerCase()) ? `
            <div style="margin-top:10px">
                <button type="button" class="small" data-action="add-custom-skill">+ Add "${esc(state.skillQuery)}" as my own skill</button>
            </div>` : ''}` : ''}
        </div>
    </div>

    <div class="card section">
        <h2>Add a project</h2>
        <p class="hint">Describe something you built (capstone, OJT, personal). SkillBridge detects the skills; you confirm them.</p>
        <form class="stack" data-form="project">
            <label>Project title <input name="title" maxlength="150" required value="${esc(state.projectDraft?.title ?? '')}"></label>
            <label>What did you build, and with what?
                <textarea name="description" maxlength="5000" required placeholder="e.g. Built a clinic booking web app with React and Node.js, stored data in MySQL, deployed it with Docker…">${esc(state.projectDraft?.description ?? '')}</textarea>
            </label>
            ${detected ? `
                <div>
                    <div class="chip-label">Detected skills: uncheck any you didn't really use</div>
                    ${detected.length ? `<div class="checks">${detected.map(s => `
                        <label class="check"><input type="checkbox" name="skillIds" value="${esc(s.id)}" checked> ${esc(s.name)}</label>`).join('')}</div>`
                        : '<p class="hint">No known skills found. Try naming the tools and languages you used.</p>'}
                </div>` : ''}
            <div class="inline">
                <button type="submit" data-intent="detect">${detected ? 'Detect again' : 'Detect skills'}</button>
                ${detected?.length ? '<button class="primary" type="submit" data-intent="save">Save project</button>' : ''}
            </div>
        </form>
    </div>`
}

// ---------------------------------------------------------------- student: matches

const jobCard = (m) => `
    <div class="card job">
        <div class="card-head">
            <div>
                <div class="title">${esc(m.job.title)}</div>
                <div class="meta">${esc(m.job.company)}${m.job.location ? ` · ${esc(m.job.location)}` : ''}${m.job.occupation ? ` · ${esc(m.job.occupation)}` : ''} · posted ${esc(fmtDate(m.job.postedAt))}</div>
            </div>
            <div class="score">
                ${statusLabel(m.status, m.missingRequired.length ? ` · ${plural(m.missingRequired.length, 'skill')} away` : '')}
                <div class="pct">${m.score}% match</div>
                ${meter(m.score, { small: true, tip: `${m.score}% weighted match (required skills count double)` })}
            </div>
        </div>
        ${m.missingRequired.length ? `<div><div class="chip-label">Missing (required)</div>${chips(m.missingRequired, 'miss')}</div>` : ''}
        ${m.matchedRequired.length ? `<div><div class="chip-label">You have</div>${chips([...m.matchedRequired, ...m.matchedPreferred])}</div>` : ''}
        ${m.missingPreferred.length ? `<div><div class="chip-label">Nice to have</div>${chips(m.missingPreferred, 'plain')}</div>` : ''}
        <div class="job-actions">
            ${m.job.url ? `<span><a href="${esc(m.job.url)}" target="_blank" rel="noopener noreferrer">View posting</a>${attribution(m.job.attribution)}</span>` : ''}
            ${practiceButton(m.score, `data-job-id="${esc(m.job.id)}"`)}
        </div>
    </div>`

// Mock interviews open at a 30% match (below that, learning comes first)
export const INTERVIEW_MIN_SCORE = 30
const practiceButton = (score, target) => score >= INTERVIEW_MIN_SCORE
    ? `<button type="button" class="small" data-action="start-interview" ${target}>Practice interview</button>`
    : `<span class="hint" data-tip="Mock interviews open at a ${INTERVIEW_MIN_SCORE}% match">Interview practice at ${INTERVIEW_MIN_SCORE}%+</span>`

// Required by some sources' terms (Remotive): credit and link back on every job
const attribution = (a) => a
    ? ` <span class="hint">· via <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a></span>`
    : ''

// ---------------------------------------------------------------- student: job alerts

export const alerts = (state) => {
    const d = state.data.alerts
    if(!d) return loading('Job alerts')
    return `
    <h1>Job alerts</h1>
    <p class="sub">New postings you are ready for, or close to (1–2 skills away), as soon as they arrive.
        ${state.live.connected ? 'You are connected: new alerts appear here instantly.' : ''}</p>
    ${d.data.length ? `<div class="grid">${d.data.map(n => `
        <div class="card job ${n.readAt ? '' : 'unread'}">
            <div class="card-head">
                <div>
                    <div class="title">${esc(n.job.title)}</div>
                    <div class="meta">${esc(n.job.company)}${n.job.location ? ` · ${esc(n.job.location)}` : ''} · alerted ${esc(fmtTime(n.createdAt))}</div>
                </div>
                <div class="score">${statusLabel(n.status)}<div class="pct">${n.score}% match</div></div>
            </div>
            <div>
                ${n.job.url ? `<a href="${esc(n.job.url)}" target="_blank" rel="noopener noreferrer">View posting</a>${attribution(n.job.source === 'remotive' ? { name: 'Remotive', url: 'https://remotive.com' } : null)} · ` : ''}
                <a href="#/matches">See what you're missing</a>
            </div>
            <div class="job-actions">${practiceButton(n.score, `data-job-id="${esc(n.job.id)}"`)}</div>
        </div>`).join('')}</div>`
    : '<div class="empty">No alerts yet. When a new posting fits your skills, it shows up here.</div>'}`
}

export const matches = (state) => {
    const d = state.data.matches
    if(!d) return loading('Job matches')
    const f = state.matchFilter
    const total = d.counts.READY + d.counts.CLOSE + d.counts.STRETCH
    const tab = (value, label, n) => `<button class="${(f.status ?? '') === value ? 'on' : ''}" data-action="match-status" data-status="${value}">${label} (${fmtNum(n)})</button>`
    return `
    <h1>Job matches</h1>
    <p class="sub">Recent postings ranked by how well your skills fit. <strong>Ready</strong>: you have every required skill. <strong>Close</strong>: 1–2 skills away.</p>
    <div class="inline" style="margin-bottom:12px">
        <label>Occupation
            <select data-change="match-occupation">
                <option value="">All occupations</option>
                ${state.occupations.map(o => `<option value="${esc(o.id)}" ${f.occupationId === o.id ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}
            </select>
        </label>
    </div>
    <div class="tabs">
        ${tab('', 'All', total)}${tab('READY', 'Ready', d.counts.READY)}${tab('CLOSE', 'Close', d.counts.CLOSE)}${tab('STRETCH', 'Stretch', d.counts.STRETCH)}
    </div>
    <div class="grid">${d.data.map(jobCard).join('') || '<div class="empty">No postings in this view.</div>'}</div>`
}

// ---------------------------------------------------------------- student: gap report

export const gap = (state) => {
    const r = state.data.gap
    if(!r) return loading('Gap report')
    if(!r.occupation) return `<h1>Gap report</h1><div class="empty">No job postings yet to compare with.</div>`

    const total = r.jobCounts.READY + r.jobCounts.CLOSE + r.jobCounts.STRETCH
    const headline = r.readiness >= 90
        ? `You have the skills most ${r.occupation.title} postings ask for.`
        : r.gaps[0] ? `Your biggest gap is ${r.gaps[0].skill.name}, asked for in ${pct(r.gaps[0].share)} of postings.` : ''

    return `
    <h1>Gap report</h1>
    <p class="sub">How ready you are for an occupation, based on ${plural(r.postings, 'recent posting')}.</p>
    <div class="inline" style="margin-bottom:16px">
        <label>Occupation
            <select data-change="gap-occupation">
                ${r.otherOccupations.map(o => `<option value="${esc(o.id)}" ${o.id === r.occupation.id ? 'selected' : ''}>${esc(o.title)} (${o.readiness}% ready)</option>`).join('')}
            </select>
        </label>
    </div>

    <div class="card hero">
        <div class="figure"><span data-count="${r.readiness}">${r.readiness}</span><small>%</small></div>
        <div class="about">
            <h2>Ready for ${esc(r.occupation.title)}</h2>
            <div class="hint">Share of the skills these postings ask for that you have, weighted by how often each is asked.</div>
            ${meter(r.readiness, { tip: `${r.readiness}% of demanded skills covered` })}
            <p style="margin:10px 0 0">${esc(headline)}</p>
        </div>
    </div>

    <div class="grid tiles section">
        ${tile('Postings you are ready for', `${fmtNum(r.jobCounts.READY)} of ${fmtNum(total)}`)}
        ${tile('1–2 skills away', fmtNum(r.jobCounts.CLOSE))}
        ${tile('Further away', fmtNum(r.jobCounts.STRETCH))}
    </div>

    ${r.nextBestSkills.length ? `
    <div class="card section">
        <h2>Learn next</h2>
        <p class="hint">The single skills that would move the most postings to Ready.</p>
        ${bars(r.nextBestSkills.map(n => ({
            name: n.skill.name,
            value: n.newlyReady + n.newlyClose * 0.25,
            label: n.newlyReady ? `+${plural(n.newlyReady, 'posting')} ready` : `+${n.newlyClose} closer`,
            tip: `Learn ${n.skill.name}: ${plural(n.newlyReady, 'posting')} become Ready, ${n.newlyClose} more move to Close`
        })))}
    </div>` : ''}

    <div class="grid two section">
        <div class="card">
            <h2>Skills you're missing</h2>
            <p class="hint">Share of ${esc(r.occupation.title)} postings that ask for each skill.</p>
            ${bars(r.gaps.slice(0, 12).map(g => ({
                name: g.skill.name, value: g.share, label: pct(g.share),
                tip: `${g.skill.name}: asked for in ${pct(g.share)} of postings`
            })), { max: 1, empty: 'No gaps among commonly asked skills.' })}
        </div>
        <div class="card">
            <h2>Skills you have that employers want</h2>
            <p class="hint">Share of postings that ask for them.</p>
            ${bars(r.strengths.map(g => ({
                name: g.skill.name, value: g.share, label: pct(g.share),
                tip: `${g.skill.name}: asked for in ${pct(g.share)} of postings`
            })), { max: 1, empty: 'Add courses, certificates or projects to see your strengths.' })}
        </div>
    </div>

    ${r.resources.length ? `
    <div class="section">
        <h2>Where to learn them (free)</h2>
        <p class="hint">A short list that covers your most important gaps without overlap.</p>
        <div class="grid two" style="margin-top:12px">${r.resources.map(x => `
            <div class="card">
                <div class="card-head"><strong>${esc(x.title)}</strong><span class="hint">${x.hours ? `~${x.hours} h` : ''}${x.free ? ' · free' : ''}</span></div>
                <div class="hint" style="margin:2px 0 8px">${esc(x.provider)}</div>
                ${chips(x.covers, 'miss')}
                <div style="margin-top:10px"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(x.provider)}</a></div>
            </div>`).join('')}
        </div>
    </div>` : ''}

    <div class="card section">
        <h2>Your readiness for other occupations</h2>
        <p class="hint">Select one above to see its gaps.</p>
        ${bars(r.otherOccupations.map(o => ({
            name: o.title, value: o.readiness / 100, label: `${o.readiness}%`,
            tip: `${o.title}: ${o.readiness}% ready, ${plural(o.postings, 'posting')}`
        })), { max: 1 })}
    </div>`
}

// ---------------------------------------------------------------- market

export const market = (state) => {
    const m = state.data.market
    if(!m) return loading('Job market')
    const occ = state.marketOccupation
    return `
    <h1>Job market</h1>
    <p class="sub">What employers are asking for in postings from the last ${m.days} days.</p>
    <div class="inline" style="margin-bottom:16px">
        <label>Occupation
            <select data-change="market-occupation">
                <option value="">All occupations</option>
                ${m.occupations.map(o => `<option value="${esc(o.id)}" ${occ === o.id ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}
            </select>
        </label>
    </div>
    <div class="grid two">
        <div class="card">
            <h2>Most requested skills</h2>
            <p class="hint">Share of ${plural(m.postings, 'posting')} asking for each (preferred counts half).</p>
            ${bars(m.skills.map(s => ({
                name: s.skill.name, value: s.share, label: pct(s.share),
                tip: `${s.skill.name}: required in ${s.required}, preferred in ${s.preferred}`
            })), { max: 1 })}
        </div>
        <div class="card">
            <h2>Postings by occupation</h2>
            <p class="hint">${m.unclassified ? `${plural(m.unclassified, 'posting')} did not fit an occupation.` : 'Every posting was classified.'}</p>
            ${bars(m.occupations.filter(o => o.postings).map(o => ({
                name: o.title, value: o.postings, label: fmtNum(o.postings), tip: `${o.title}: ${plural(o.postings, 'posting')}`
            })))}
        </div>
    </div>`
}

// ---------------------------------------------------------------- school: program insights

export const programs = (state) => {
    const list = state.programList ?? []
    const r = state.data.programs
    const selector = `
        <div class="inline" style="margin-bottom:16px">
            <label>Program
                <select data-change="program">
                    ${list.map(p => `<option value="${esc(p.id)}" ${p.id === state.programId ? 'selected' : ''}>${esc(p.school)} · ${esc(p.code)}</option>`).join('')}
                </select>
            </label>
        </div>`
    if(!r) return `<h1>Program insights</h1>${selector}<p class="sub">Loading…</p>`
    const c = r.cohort

    return `
    <h1>Program insights</h1>
    <p class="sub">${esc(r.program.name)} at ${esc(r.program.school)}, compared with ${plural(r.postings, 'recent posting')} for its target occupations: ${esc(r.targetOccupations.map(o => o.title).join(', '))}.</p>
    ${selector}
    ${state.user.role === 'ADMIN' ? unlistedSchools(state.data.unlisted) : ''}

    <div class="card hero">
        <div class="figure"><span data-count="${r.curriculumCoverage}">${r.curriculumCoverage}</span><small>%</small></div>
        <div class="about">
            <h2>Curriculum coverage</h2>
            <div class="hint">Share of the skills target employers ask for that at least one course teaches, weighted by demand.</div>
            ${meter(r.curriculumCoverage, { tip: `${r.curriculumCoverage}% of demanded skills are taught` })}
        </div>
    </div>

    <div class="grid tiles section">
        ${tile('Students on SkillBridge', fmtNum(c.students))}
        ${tile('Average student readiness', `${c.averageReadiness}%`)}
        ${tile('Ready for at least one posting', `${fmtNum(c.readyForAtLeastOneJob)} of ${fmtNum(c.students)}`)}
        ${tile('Close to a posting', fmtNum(c.closeToAJob), '1–2 skills away')}
    </div>

    <div class="grid two section">
        <div class="card">
            <h2>In demand, not taught</h2>
            <p class="hint">Share of target postings asking for skills no course covers. Candidates for new content.</p>
            ${bars(r.curriculumGaps.slice(0, 12).map(g => ({
                name: g.skill.name, value: g.share, label: pct(g.share),
                tip: `${g.skill.name}: required in ${g.required}, preferred in ${g.preferred} postings`
            })), { max: 1, empty: 'The curriculum covers every commonly requested skill.' })}
        </div>
        <div class="card">
            <h2>Students' most common gaps</h2>
            <p class="hint">Share of this program's students missing each in-demand skill.</p>
            ${bars(c.commonGaps.map(g => ({
                name: g.skill.name, value: g.percent / 100, label: `${g.percent}%`,
                tip: `${g.students} of ${c.students} students are missing ${g.skill.name}`
            })), { max: 1, empty: 'No students yet.' })}
        </div>
    </div>

    <div class="card section">
        <h2>Taught and in demand</h2>
        <p class="hint">Where each requested skill is covered in the curriculum.</p>
        <div class="table-wrap"><table>
            <thead><tr><th>Skill</th><th class="num">Share of postings</th><th>Taught in</th></tr></thead>
            <tbody>${r.covered.map(x => `<tr><td>${esc(x.skill.name)}</td><td class="num">${pct(x.share)}</td><td>${esc(x.courses.join(', '))}</td></tr>`).join('')}</tbody>
        </table></div>
    </div>

    ${r.notInDemand.length ? `
    <div class="card section">
        <h2>Taught, but not asked for in target postings</h2>
        <p class="hint">Not necessarily wrong (fundamentals matter), but worth reviewing against what employers list.</p>
        <div class="chips">${r.notInDemand.map(x => `<span class="chip plain" data-tip="${esc(x.courses.join(', '))}">${esc(x.skill.name)}</span>`).join('')}</div>
    </div>` : ''}`
}

// ---------------------------------------------------------------- admin: ingestion

const SAMPLE_JSON = JSON.stringify([{
    externalId: 'JF-2026-001',
    title: 'Junior Web Developer',
    company: 'Sample Company Inc.',
    location: 'Quezon City',
    description: 'Requirements:\n- JavaScript and React\n- SQL\n- Git\nDocker is a plus.',
    url: 'https://example.com/jobs/1'
}], null, 2)
const SAMPLE_CSV = 'title,company,location,description,external_id\n"Junior Data Analyst","Sample Company Inc.","Cebu City","Requirements:\n- SQL and Power BI\n- MS Excel\nPython is a plus.",JF-2026-002'

export const ingest = (state) => {
    const d = state.data.ingest
    if(!d) return loading('Ingestion')
    const draft = state.importDraft ?? { format: 'json', data: SAMPLE_JSON, source: 'peso-jobfair' }
    return `
    <h1>Ingestion</h1>
    <p class="sub">Every source goes through the same pipeline: normalize → dedupe → extract skills → classify occupation.</p>

    ${aiIntakeCard(state)}
    ${d.reviews.length ? reviewQueue(d.reviews) : ''}

    <div class="grid two section">
        <div class="card">
            <h2>Import postings</h2>
            <p class="hint">Job fair lists (PESO), partner employers, exports. Re-importing is safe.</p>
            <form class="stack" data-form="import">
                <div class="row">
                    <label>Source name <input name="source" required maxlength="100" value="${esc(draft.source)}"></label>
                    <label>Format
                        <select name="format" data-change="import-format">
                            <option value="json" ${draft.format === 'json' ? 'selected' : ''}>JSON array</option>
                            <option value="csv" ${draft.format === 'csv' ? 'selected' : ''}>CSV with header row</option>
                        </select>
                    </label>
                </div>
                <label>Data <textarea class="code" name="data" required>${esc(draft.data)}</textarea></label>
                <div class="inline"><button class="primary" type="submit">Import</button></div>
            </form>
            ${state.lastImport ? importResult(state.lastImport) : ''}
        </div>

        <div class="card">
            <h2>Taxonomy changed?</h2>
            <p class="hint">Re-read every stored posting with the current skills and aliases.</p>
            <button data-action="reextract">Re-extract all postings</button>
        </div>
    </div>

    <div class="grid two section">
        <div class="card">
            <h2>Automatic sources</h2>
            <p class="hint">Pulled on a schedule, screened with the same scam rules, then matched to students, who are alerted right away.
                Only sources that allow it: LinkedIn, Indeed and JobStreet forbid scraping in their terms.</p>
            <div id="sources-table">${sourcesTable(d.sources)}</div>
            ${sourceForm(state, d.types)}
        </div>
        <div class="card">
            <h2>Live activity <span class="live-inline ${state.live.connected ? 'on' : ''}"><span class="dot"></span>${state.live.connected ? 'live' : 'reconnecting'}</span></h2>
            <p class="hint">Source runs and student alerts as they happen.</p>
            <div id="live-activity">${activityList(state.live.activity)}</div>
        </div>
    </div>

    <div class="card section">
        <h2>Import history</h2>
        <div class="table-wrap"><table>
            <thead><tr><th>When</th><th>Source</th><th class="num">Received</th><th class="num">New</th><th class="num">Updated</th><th class="num">Duplicates</th><th class="num">Failed</th></tr></thead>
            <tbody>${d.imports.map(r => `<tr>
                <td>${esc(fmtTime(r.startedAt))}</td><td>${esc(r.source)}</td>
                <td class="num">${r.received}</td><td class="num">${r.created}</td><td class="num">${r.updated}</td>
                <td class="num">${r.duplicates}</td><td class="num">${r.failed}</td></tr>`).join('')}</tbody>
        </table></div>
    </div>`
}

export const SAMPLES = { json: SAMPLE_JSON, csv: SAMPLE_CSV }

const every = (minutes) => minutes % 60 === 0 ? `every ${plural(minutes / 60, 'hour')}` : `every ${minutes} min`

export const sourcesTable = (sources) => sources.length ? `
    <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Schedule</th><th>Last run</th><th></th></tr></thead>
        <tbody>${sources.map(s => `<tr>
            <td><strong>${esc(s.name)}</strong><br><span class="hint">${esc(s.label)}</span></td>
            <td>${s.enabled ? esc(every(s.effectiveIntervalMinutes)) : '<span class="hint">Paused</span>'}
                ${s.enabled && s.nextRunAt ? `<br><span class="hint">next ${esc(fmtTime(s.nextRunAt))}</span>` : ''}</td>
            <td>${s.lastRunAt
                ? `${s.lastStatus === 'OK' ? 'OK' : `<span class="failed" data-tip="${esc(s.lastError ?? '')}">Failed</span>`}<br><span class="hint">${esc(fmtTime(s.lastRunAt))}</span>`
                : '<span class="hint">Not yet</span>'}</td>
            <td class="actions">
                <button class="small" data-action="run-source" data-id="${esc(s.id)}" ${s.enabled ? '' : 'disabled'}>Run now</button>
                <button class="small" data-action="toggle-source" data-id="${esc(s.id)}" data-enabled="${s.enabled}">${s.enabled ? 'Pause' : 'Resume'}</button>
            </td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="hint">No automatic sources yet.</p>'

const sourceForm = (state, types = []) => {
    const type = state.sourceType ?? 'REMOTIVE'
    const info = types.find(t => t.type === type)
    return `
    <form class="stack section" data-form="source">
        <div class="row">
            <label>Type
                <select name="type" data-change="source-type">
                    ${types.map(t => `<option value="${esc(t.type)}" ${t.type === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
                </select>
            </label>
            <label>Name <input name="name" required maxlength="60" value="${type === 'REMOTIVE' ? 'remotive' : ''}" placeholder="partner-acme"></label>
        </div>
        ${type === 'REMOTIVE' ? `
            <p class="hint">Remote jobs open to applicants in the Philippines. Remotive's terms: pulled at most 4 times a day,
                shown 24 h after publication, and credited with a link on every job (SkillBridge does all three).
                They also forbid using their jobs to collect sign-ups; confirm your use with Remotive (hello@remotive.com).</p>` : ''}
        ${type === 'JOOBLE' ? `
            ${info?.configured ? '' : '<div class="notice">Add JOOBLE_API_KEY to the server\'s .env first. Request a free key at jooble.org/api/about.</div>'}
            <div class="row">
                <label>Keywords <span class="hint">Comma-separated, one search each</span><input name="keywords" value="web developer, data analyst, customer service"></label>
                <label>Location <input name="location" value="Philippines"></label>
            </div>` : ''}
        ${type === 'JSON_FEED' ? `
            <label>Feed URL <input name="url" type="url" required placeholder="https://careers.example.com/jobs.json"></label>
            <label>Items path <input name="itemsPath" placeholder="data.jobs (empty = top-level array)"></label>
            <label>Field map (JSON) <textarea class="code" name="fieldMap" style="min-height:90px">{ "externalId": "id", "title": "title", "company": "company.name", "description": "description" }</textarea></label>` : ''}
        <label>Pull every (minutes) <span class="hint">Minimum ${info?.minIntervalMinutes ?? 15} for this source</span>
            <input name="intervalMinutes" type="number" min="${info?.minIntervalMinutes ?? 15}" step="15" value="${info?.minIntervalMinutes ?? 60}">
        </label>
        <div class="inline"><button type="submit">Add source</button></div>
    </form>`
}

export const activityList = (items) => items.length
    ? `<ul class="activity">${items.map(a => `<li>
        <span class="hint">${esc(fmtTime(a.at))}</span>
        ${a.kind === 'notified'
            ? `${plural(a.notifications, 'student alert')} sent for ${plural(a.postings, 'new posting')}`
            : a.ok
                ? `<strong>${esc(a.source)}</strong> (${esc(a.trigger)}): ${a.fetched} fetched, ${a.created} new, ${a.duplicates} already stored${a.heldForReview ? `, <strong>${a.heldForReview} held for review</strong>` : ''}`
                : `<strong>${esc(a.source)}</strong> failed: ${esc(a.error)}`}
    </li>`).join('')}</ul>`
    : '<p class="hint">Waiting for the next source run…</p>'

const importResult = (r) => `
    <div class="notice section">
        Import finished: ${r.created} new, ${r.updated} updated, ${r.duplicates} duplicate, ${r.failed} failed (of ${r.received}).
        ${r.errors?.length ? `<ul style="margin:6px 0 0;padding-left:18px">${r.errors.map(e => `<li>Item ${e.index + 1}: ${esc(e.reason)}</li>`).join('')}</ul>` : ''}
    </div>`

// ---------- AI intake of pasted hiring posts ----------

const RISK_LABEL = { LOW: 'Clean', MEDIUM: 'Check', HIGH: 'Likely scam' }

const aiIntakeCard = (state) => {
    if(!state.ai.status?.enabled) return `
        <div class="card"><h2>Paste hiring posts (AI)</h2>
        <p class="hint">Set AI_API_KEY, AI_BASE_URL and AI_MODEL in the server's .env to read Facebook posts, emails and announcements with AI.</p></div>`
    const draft = state.aiIntakeDraft ?? { source: 'fb-hiring-posts', text: '' }
    const r = state.lastAiIntake
    return `
    <div class="card">
        <h2>Paste hiring posts (AI)</h2>
        <p class="hint">Facebook "We're hiring!" posts, emails, PESO announcements, PDF text. Paste several at once.
            The AI splits them into postings; clean ones are published right away and student matches update.
            Posts with red flags (fees, OTP/bank details, unrealistic pay, missing company) wait for you below.</p>
        <form class="stack" data-form="ai-intake">
            <label>Source name <input name="source" required maxlength="100" value="${esc(draft.source)}"></label>
            <label>Hiring posts <textarea name="text" required maxlength="20000" style="min-height:180px" placeholder="WE'RE HIRING! Acme BPO is looking for Customer Service Representatives…">${esc(draft.text)}</textarea></label>
            <div class="inline"><button class="primary" type="submit" ${state.aiIntakeBusy ? 'disabled' : ''}>${state.aiIntakeBusy ? 'Reading posts…' : 'Read with AI'}</button></div>
        </form>
        ${r ? `<div class="notice section">
            Found ${plural(r.found, 'posting')}: ${r.published.length} published${r.run ? ` (${r.run.created} new, ${r.run.duplicates} already stored)` : ''}, ${r.flagged.length} held for review.
            ${r.published.length ? `<ul style="margin:6px 0 0;padding-left:18px">${r.published.map(p => `<li>${esc(p.title)} · ${esc(p.company)}</li>`).join('')}</ul>` : ''}
        </div>` : ''}
    </div>`
}

const reviewQueue = (reviews) => `
    <div class="card section">
        <h2>Needs review (${reviews.length})</h2>
        <p class="hint">Held back by the AI or the built-in scam rules. Correct the fields if needed, then publish or reject.</p>
        <div class="grid">${reviews.map(r => `
            <form class="stack review" data-form="review-publish" data-id="${esc(r.id)}">
                <div><span class="risk ${esc(r.risk.toLowerCase())}">${esc(RISK_LABEL[r.risk])}</span> <span class="hint">${esc(r.source)} · ${esc(fmtTime(r.createdAt))}</span></div>
                ${r.reasons.length ? `<ul class="reasons">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
                <div class="row">
                    <label>Title <input name="title" value="${esc(r.data.title)}"></label>
                    <label>Company <input name="company" value="${esc(r.data.company)}"></label>
                </div>
                <div class="row">
                    <label>Location <input name="location" value="${esc(r.data.location)}"></label>
                    <label>Application link <input name="url" value="${esc(r.data.url)}"></label>
                </div>
                <label>Description <textarea name="description">${esc(r.data.description)}</textarea></label>
                <div class="inline">
                    <button class="primary" type="submit">Publish</button>
                    <button type="button" data-action="review-reject" data-id="${esc(r.id)}">Reject</button>
                </div>
            </form>`).join('')}
        </div>
    </div>`

// ---------------------------------------------------------------- admin: postings

export const jobs = (state) => {
    const d = state.data.jobs
    if(!d) return loading('Postings')
    const open = state.openJob
    return `
    <h1>Postings</h1>
    <p class="sub">Check what the extractor found in each posting. Blue = required, grey = preferred.</p>
    <form class="inline" data-form="job-search" style="margin-bottom:16px">
        <label>Search title or company <input name="q" value="${esc(state.jobQuery ?? '')}"></label>
        <button type="submit">Search</button>
    </form>
    <div class="grid">${d.map(j => `
        <div class="card job">
            <div class="card-head">
                <div>
                    <div class="title">${esc(j.title)}</div>
                    <div class="meta">${esc(j.company)} · ${esc(j.occupation?.title ?? 'Unclassified')} · ${esc(j.source)} · ${esc(fmtDate(j.postedAt))}</div>
                </div>
                <button class="small" data-action="open-job" data-id="${esc(j.id)}">${open?.id === j.id ? 'Hide' : 'Show'} posting</button>
            </div>
            <div class="chips">${j.skills.map(s => `<span class="chip ${s.importance === 'PREFERRED' ? 'plain' : ''}">${esc(s.name)}</span>`).join('') || '<span class="hint">No skills recognized. Add aliases to the taxonomy?</span>'}</div>
            ${open?.id === j.id ? `<pre style="white-space:pre-wrap;font:inherit;background:var(--surface-2);padding:12px;border-radius:8px;margin:0">${esc(open.description)}</pre>` : ''}
        </div>`).join('') || '<div class="empty">No postings found.</div>'}
    </div>`
}

// ---------------------------------------------------------------- admin: taxonomy

export const taxonomy = (state) => {
    const skills = state.data.taxonomy
    if(!skills) return loading('Skills taxonomy')
    const byId = new Map(skills.map(s => [s.id, s]))
    const categories = [...new Set(skills.map(s => s.category))].sort()
    return `
    <h1>Skills taxonomy</h1>
    <p class="sub">${plural(skills.length, 'skill')}. Aliases are the ways postings write a skill. A parent means "counts towards": knowing MySQL satisfies a posting asking for SQL.</p>
    ${state.data.requestedSkills?.length ? `
    <div class="card" style="margin-bottom:18px">
        <h2>Skills students added themselves</h2>
        <p class="hint">Not in the list yet, so job matching cannot use them. Pick one to add it below
            (or add its spelling as an alias of an existing skill): every student who typed it gets the real skill.</p>
        <div class="chips">${state.data.requestedSkills.map(r => `
            <button type="button" class="chip plain" data-action="prefill-skill" data-name="${esc(r.name)}">+ ${esc(r.name)} <span class="hint">· ${plural(r.students, 'student')}</span></button>`).join('')}
        </div>
    </div>` : ''}
    <div class="card">
        <h2>Add a skill</h2>
        <form class="stack" data-form="new-skill" style="margin-top:10px">
            <div class="row">
                <label>Name <input name="name" required placeholder="Power Automate"></label>
                <label>Category <input name="category" required list="categories" placeholder="Office"></label>
            </div>
            <datalist id="categories">${categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
            <div class="row">
                <label>Aliases <span class="hint">Comma-separated</span><input name="aliases" placeholder="ms power automate, microsoft flow"></label>
                <label>Counts towards (parent)
                    <select name="parentId"><option value="">None</option>
                        ${[...skills].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
                    </select>
                </label>
            </div>
            <div class="inline"><button class="primary" type="submit">Add skill</button></div>
        </form>
    </div>
    ${categories.map(cat => `
    <div class="card section">
        <h2>${esc(cat)}</h2>
        <div class="table-wrap"><table>
            <thead><tr><th>Skill</th><th>Aliases</th><th>Counts towards</th></tr></thead>
            <tbody>${skills.filter(s => s.category === cat).map(s => `<tr>
                <td>${esc(s.name)}</td>
                <td class="hint">${esc(s.aliases.join(', ')) || '—'}</td>
                <td>${s.parentId ? esc(byId.get(s.parentId)?.name) : '—'}</td></tr>`).join('')}</tbody>
        </table></div>
    </div>`).join('')}`
}

// ---------------------------------------------------------------- student: AI assistant

const SUGGESTIONS = [
    'What should I learn next to get more job offers?',
    'Which jobs can I apply to right now?',
    'Make me a 4-week study plan for my biggest gaps.',
    'Which occupation am I closest to?'
]

// Escaped text with line breaks kept and http(s) links made clickable
const richText = (text) => esc(text)
    // esc() has already turned quotes into entities, so a link cannot break out of href
    .replace(/https?:\/\/(?:(?!&quot;|&#39;|&gt;)[^\s<)])+/g, (match) => {
        const url = match.replace(/[.,;:!?]+$/, '')
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${match.slice(url.length)}`
    })
    .replace(/\n/g, '<br>')

export const assistant = (state) => {
    const ai = state.ai
    if(!ai.status) return loading('AI assistant')
    if(!ai.status.enabled) return `
        <h1>AI assistant</h1>
        <div class="empty">The AI assistant is not set up on this server yet.</div>`

    return `
    <h1>AI assistant</h1>
    <p class="sub">Ask about your job matches, skill gaps and what to learn next. Answers come from your own profile and real postings.</p>
    <div class="card chat">
        <div class="chat-log" id="chat-log" aria-live="polite">
            ${ai.messages.length ? ai.messages.map(m => `
                <div class="msg ${m.role === 'user' ? 'me' : 'bot'}">${richText(m.content)}</div>`).join('') : `
                <div class="chat-empty">
                    <p class="hint">Try one of these:</p>
                    <div class="chips">${SUGGESTIONS.map(q => `<button class="chip plain" data-action="ai-suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
                </div>`}
            ${ai.pending ? '<div class="msg bot thinking">Checking your profile and the job market…</div>' : ''}
        </div>
        <form class="chat-form" data-form="ai-chat">
            <textarea name="q" rows="2" maxlength="2000" placeholder="Ask anything about your career…" required ${ai.pending ? 'disabled' : ''}></textarea>
            <div class="inline">
                <button type="submit" class="primary" ${ai.pending ? 'disabled' : ''}>Send</button>
                ${ai.messages.length ? '<button type="button" data-action="ai-clear">New conversation</button>' : ''}
            </div>
        </form>
        <p class="hint">AI can make mistakes. Check important details in the posting itself.</p>
    </div>`
}

// ---------------------------------------------------------------- student: check a job link

const READ_FROM = {
    'structured-data': 'Read from the job data the site publishes',
    'page-text': 'Read from the page text: check the details',
    'page-text+ai': 'AI picked the job out of the page text',
    pasted: 'From the description you pasted'
}

export const jobcheck = (state) => {
    const mode = state.jobCheckMode ?? 'link'
    const r = state.jobCheck
    const busy = state.jobCheckBusy
    const draft = state.jobCheckDraft ?? {}
    return `
    <h1>Check a job link</h1>
    <p class="sub">Found a job on Facebook, a company site or a job board? Paste the link and see how your skills fit, what proves them, and what to learn.</p>
    <div class="card">
        <div class="tabs">
            <button class="${mode === 'link' ? 'on' : ''}" data-action="jobcheck-mode" data-mode="link">Paste a link</button>
            <button class="${mode === 'text' ? 'on' : ''}" data-action="jobcheck-mode" data-mode="text">Paste the description</button>
        </div>
        <form class="stack" data-form="jobcheck">
            ${mode === 'link' ? `
                <label>Job posting link <input name="url" type="url" required placeholder="https://careers.company.com/jobs/123" value="${esc(draft.url ?? '')}"></label>
                <p class="hint">Sites that need a login (LinkedIn, Indeed, Facebook) usually block other apps. If the link fails, copy the description and use "Paste the description".</p>` : `
                <div class="row">
                    <label>Job title <input name="title" maxlength="200" value="${esc(draft.title ?? '')}" placeholder="Junior Web Developer"></label>
                    <label>Company <input name="company" maxlength="200" value="${esc(draft.company ?? '')}"></label>
                </div>
                <label>Job description <textarea name="text" required minlength="80" maxlength="20000" style="min-height:180px" placeholder="Paste the whole posting: duties, qualifications, requirements…">${esc(draft.text ?? '')}</textarea></label>`}
            <div class="inline"><button class="primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Reading the job…' : 'Check my fit'}</button></div>
        </form>
    </div>
    ${r ? jobCheckResult(state, r) : ''}`
}

const jobCheckResult = (state, r) => {
    const p = r.posting
    const m = r.match
    return `
    <div class="card section">
        <div class="card-head">
            <div>
                <h2>${esc(p.title)}</h2>
                <div class="hint">${[p.company, p.location, p.occupation].filter(Boolean).map(esc).join(' · ')}</div>
                <div class="hint">${esc(READ_FROM[p.readFrom] ?? '')}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open posting</a>` : ''}</div>
            </div>
            ${m ? `<div class="score">${statusLabel(m.status, m.missingRequired.length ? ` · ${plural(m.missingRequired.length, 'skill')} away` : '')}
                <div class="pct"><span data-count="${m.score}">${m.score}</span>% match</div>${meter(m.score, { small: true })}</div>` : ''}
        </div>
    </div>
    ${!m ? `<div class="notice section">Only ${plural(p.skillsFound, 'skill')} recognized in this posting, too few to judge your fit.
        Try pasting the full description, or check the requirements yourself.</div>` : `
    <div class="grid two section">
        <div class="card">
            <h2>Your best evidence</h2>
            <p class="hint">Skills this job asks for that you have, and what proves each one. Mention these in your application.</p>
            ${r.evidence.length ? `<ul class="evidence">${r.evidence.map(e => `
                <li><strong>${esc(e.skill.name)}</strong>${e.proof.length ? `<span class="hint"> ${e.proof.map(esc).join(' · ')}</span>` : ''}</li>`).join('')}</ul>`
                : '<p class="empty">None of your skills appear in this posting yet.</p>'}
        </div>
        <div class="card">
            <h2>What you're missing</h2>
            ${m.missingRequired.length ? `<div class="chip-label">Required</div>${chips(m.missingRequired, 'miss')}` : '<p class="hint">You have every required skill. Apply!</p>'}
            ${m.missingPreferred.length ? `<div class="chip-label">Nice to have</div>${chips(m.missingPreferred, 'plain')}` : ''}
            ${r.resources.length ? `<div class="chip-label">Learn them for free</div>
                <ul class="evidence">${r.resources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>
                    <span class="hint"> ${esc(x.provider)}${x.hours ? ` · ~${x.hours} h` : ''} · covers ${x.covers.map(c => esc(c.name)).join(', ')}</span></li>`).join('')}</ul>` : ''}
        </div>
    </div>`}
    <div class="card section">
        <h2>Cover letter</h2>
        ${r.aiAvailable ? `
            <p class="hint">Written from your real profile only. Read it and adjust before sending.</p>
            ${state.coverLetter ? `
                <textarea class="letter" id="cover-letter" rows="14">${esc(state.coverLetter)}</textarea>
                <div class="inline" style="margin-top:10px">
                    <button class="primary" data-action="copy-letter">Copy</button>
                    <button data-action="cover-letter" ${state.coverLetterBusy ? 'disabled' : ''}>${state.coverLetterBusy ? 'Writing…' : 'Write another version'}</button>
                </div>` : `
                <button class="primary" data-action="cover-letter" ${state.coverLetterBusy ? 'disabled' : ''}>${state.coverLetterBusy ? 'Writing…' : 'Write a cover letter for this job'}</button>`}`
        : '<p class="hint">The AI writer is not set up on this server.</p>'}
    </div>
    ${m ? `
    <div class="card section">
        <h2>Practice the interview</h2>
        <p class="hint">An AI interviewer asks questions written from this job's description, then gives you feedback.</p>
        ${practiceButton(m.score, 'data-from="jobcheck"')}
    </div>` : ''}`
}

// ---------------------------------------------------------------- student: resume maker

export const resume = (state) => {
    const d = state.data.resume
    if(!d) return loading('Resume maker')
    const input = state.resumeDraft ?? d.input
    const c = input.contact ?? {}
    const busy = state.resumeBusy

    const expRow = (e, i) => `
        <div class="entry">
            <div class="row">
                <label>Role <input name="exp.${i}.role" maxlength="120" placeholder="OJT IT Intern" value="${esc(e.role)}"></label>
                <label>Organization <input name="exp.${i}.organization" maxlength="150" placeholder="City Hall MIS Office" value="${esc(e.organization)}"></label>
            </div>
            <div class="row">
                <label>Dates <input name="exp.${i}.dates" maxlength="60" placeholder="Jun – Aug 2026" value="${esc(e.dates)}"></label>
                <label>Location <input name="exp.${i}.location" maxlength="100" placeholder="Capas, Tarlac" value="${esc(e.location ?? '')}"></label>
            </div>
            <label>What you did <span class="hint">Plain sentences are fine${d.aiAvailable ? '; the AI polishes the wording but never adds facts' : ''}</span>
                <textarea name="exp.${i}.description" maxlength="1500" placeholder="Fixed computers and printers. Helped staff with Excel reports…">${esc(e.description)}</textarea></label>
            <button type="button" class="link small" data-action="resume-remove" data-list="experience" data-index="${i}">Remove</button>
        </div>`
    const eduRow = (e, i) => `
        <div class="entry">
            <div class="row">
                <label>School <input name="edu.${i}.school" maxlength="150" placeholder="Dominican College of Tarlac" value="${esc(e.school)}"></label>
                <label>Years <input name="edu.${i}.years" maxlength="40" placeholder="2022 – Present" value="${esc(e.years)}"></label>
            </div>
            <div class="row">
                <label>Degree <input name="edu.${i}.degree" maxlength="150" placeholder="Bachelor of Science in Information Technology" value="${esc(e.degree)}"></label>
                <label>Location <input name="edu.${i}.location" maxlength="100" placeholder="Capas, Tarlac" value="${esc(e.location ?? '')}"></label>
            </div>
            <button type="button" class="link small" data-action="resume-remove" data-list="education" data-index="${i}">Remove</button>
        </div>`
    const projRow = (e, i) => `
        <div class="entry">
            <div class="row">
                <label>Project title <input name="proj.${i}.title" maxlength="150" placeholder="Clinic booking system" value="${esc(e.title)}"></label>
                <label>Tools used <input name="proj.${i}.tools" maxlength="200" placeholder="React, Firebase" value="${esc(e.tools ?? '')}"></label>
            </div>
            <label>What it does / what you did <span class="hint">Plain sentences are fine${d.aiAvailable ? '; the AI polishes the wording but never adds facts' : ''}</span>
                <textarea name="proj.${i}.description" maxlength="1500" placeholder="Built a booking page for patients. Made the admin dashboard…">${esc(e.description ?? '')}</textarea></label>
            <button type="button" class="link small" data-action="resume-remove" data-list="projects" data-index="${i}">Remove</button>
        </div>`
    const certRow = (e, i) => `
        <div class="entry">
            <label>Certificate <input name="cert.${i}.name" maxlength="150" placeholder="Computer Systems Servicing NC II" value="${esc(e.name)}"></label>
            <div class="row">
                <label>Issued by <input name="cert.${i}.issuer" maxlength="150" placeholder="TESDA" value="${esc(e.issuer ?? '')}"></label>
                <label>Date <input name="cert.${i}.date" maxlength="40" placeholder="2025" value="${esc(e.date ?? '')}"></label>
            </div>
            <button type="button" class="link small" data-action="resume-remove" data-list="certifications" data-index="${i}">Remove</button>
        </div>`

    return `
    <h1>Resume maker</h1>
    <p class="sub">A skills-first resume: choose the skills to show, add your experience, projects and certificates, and build it. Certificates and projects on your profile are included too. Then see the jobs this resume is strongest for.</p>
    <div class="resume-layout">
        <form class="card stack" data-form="resume">
            <h2>Your details</h2>
            <div class="row">
                <label>Full name <input name="fullName" required maxlength="120" value="${esc(c.fullName)}"></label>
                <label>Email <input name="email" type="email" maxlength="120" value="${esc(c.email)}"></label>
            </div>
            <div class="row">
                <label>Phone <input name="phone" maxlength="40" value="${esc(c.phone)}"></label>
                <label>City <input name="location" maxlength="120" value="${esc(c.location)}"></label>
            </div>
            <label>Portfolio / LinkedIn / GitHub <input name="link" maxlength="200" value="${esc(c.link)}"></label>
            <label>Job you're aiming for <input name="targetRole" maxlength="100" list="occupation-list" placeholder="Junior Web Developer" value="${esc(input.targetRole)}"></label>
            <datalist id="occupation-list">${(state.occupations ?? []).map(o => `<option value="${esc(o.title)}">`).join('')}</datalist>
            <label>About you <span class="hint">A few honest lines: what you study, what you like doing</span>
                <textarea name="about" maxlength="1000">${esc(input.about)}</textarea></label>

            ${resumeSkillsField(input.skills ?? [], d.profileSkills ?? [])}

            <h2 class="section">Experience</h2>
            <p class="hint">OJT, part-time jobs, freelance, org officer roles and volunteering all count.</p>
            ${(input.experience ?? []).map(expRow).join('')}
            <div><button type="button" class="small" data-action="resume-add" data-list="experience">+ Add experience</button></div>

            <h2 class="section">Education</h2>
            <p class="hint">Leave it empty and the section is not printed.</p>
            ${(input.education ?? []).map(eduRow).join('')}
            <div><button type="button" class="small" data-action="resume-add" data-list="education">+ Add education</button></div>

            <h2 class="section">Projects</h2>
            <p class="hint">School, capstone or personal projects that are not on your profile yet.</p>
            <label class="check"><input type="checkbox" name="includeProjects" ${input.includeProjects !== false ? 'checked' : ''}> Also include the projects on my profile</label>
            ${(input.projects ?? []).map(projRow).join('')}
            <div><button type="button" class="small" data-action="resume-add" data-list="projects">+ Add project</button></div>

            <h2 class="section">Certifications</h2>
            <p class="hint">Certificates on your profile are printed automatically. Add any others here (trainings, online courses, seminars).</p>
            ${(input.certifications ?? []).map(certRow).join('')}
            <div><button type="button" class="small" data-action="resume-add" data-list="certifications">+ Add certificate</button></div>

            <div class="inline">
                <button class="primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Building…' : d.aiAvailable ? 'Build my resume with AI' : 'Build my resume'}</button>
                ${d.content ? '<button type="button" data-action="print-resume">Print / save as PDF</button>' : ''}
            </div>
            ${d.updatedAt ? `<p class="hint">Last built ${esc(fmtTime(d.updatedAt))}${d.generatedBy === 'AI' ? ' · wording polished by AI' : ''}</p>` : ''}
        </form>
        <div class="resume-preview">${d.content ? resumeDoc(d.content) : `
            <div class="card empty-resume"><p>Your resume appears here after you build it.</p></div>`}</div>
    </div>
    ${d.suggestions ? resumeSuggestions(d.suggestions) : ''}`
}

// Skills the student puts on the resume themselves. Profile skills are only suggestions.
const resumeSkillsField = (chosen, profileSkills) => {
    const picked = new Set(chosen.map(s => s.toLowerCase()))
    const offer = profileSkills.filter(s => !picked.has(s.name.toLowerCase()))
    return `
            <h2 class="section">Skills</h2>
            <p class="hint">Only the skills you add here appear on your resume. Put the ones you can back up in an interview.</p>
            <div class="chips skill-picked" aria-label="Skills on your resume">
                ${chosen.length ? chosen.map((s, i) => `
                    <span class="chip">${esc(s)}<input type="hidden" name="skill" value="${esc(s)}"><button type="button" aria-label="Remove ${esc(s)}" data-action="resume-skill-remove" data-index="${i}">×</button></span>`).join('')
                : '<span class="hint">No skills added yet.</span>'}
            </div>
            <div class="skill-adder">
                <label for="resume-skill-input">Type any skill <span class="hint">Not in the suggestions below? Type it here and press Enter.</span></label>
                <div class="skill-adder-row">
                    <input id="resume-skill-input" maxlength="60" placeholder="e.g. Canva, CapCut, Bookkeeping" data-enter="resume-skill-add" autocomplete="off">
                    <button type="button" class="primary" data-action="resume-skill-add">+ Add skill</button>
                </div>
            </div>
            ${offer.length ? `
            <div>
                <div class="chip-label">From your profile: tap to add</div>
                <div class="chips">
                    ${offer.map(s => `<button type="button" class="chip plain" data-action="resume-skill-suggest" data-name="${esc(s.name)}" data-tip="${esc(s.category)}">+ ${esc(s.name)}</button>`).join('')}
                    <button type="button" class="link small" data-action="resume-skill-all">Add all ${offer.length}</button>
                </div>
            </div>` : ''}`
}

// The printable document
// Classic one-column resume (the format recruiters and ATS read best):
//   NAME
//   email ◆ phone ◆ location ◆ link
//   PROFESSIONAL SUMMARY / WORK EXPERIENCE / PROJECTS / EDUCATION / CERTIFICATIONS & SKILLS
// Each entry: bold name + bold date on the right, italic role + italic location below.
const resumeDoc = (r) => {
    const contact = [r.contact?.email, r.contact?.phone, r.contact?.location, r.contact?.link].filter(Boolean)
    const section = (title, body) => body ? `<section><h3>${esc(title)}</h3>${body}</section>` : ''
    const line = (left, right, cls) => left || right
        ? `<div class="line ${cls}"><span>${left}</span>${right ? `<span>${right}</span>` : ''}</div>` : ''
    const bullets = (list) => list?.length ? `<ul>${list.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''
    const skills = r.skillList ?? r.skillGroups?.flatMap(g => g.skills) ?? []
    const certs = r.certifications ?? []

    return `
    <article class="resume-doc" id="resume-doc">
        <header>
            <h2>${esc(r.name)}</h2>
            ${contact.length ? `<div class="contact">${contact.map(esc).join(' <span class="sep">◆</span> ')}</div>` : ''}
        </header>
        ${section('Professional Summary', r.summary ? `<p>${esc(r.summary)}</p>` : '')}
        ${section('Work Experience', r.experience?.map(e => `
            <div class="item">
                ${line(esc(e.organization || e.role), esc(e.dates), 'head')}
                ${e.organization ? line(esc(e.role), esc(e.location ?? ''), 'role') : line('', esc(e.location ?? ''), 'role')}
                ${bullets(e.bullets)}
            </div>`).join(''))}
        ${section('Projects', r.projects?.map(p => `
            <div class="item">
                ${line(esc(p.title), '', 'head')}
                ${p.skills?.length ? line(esc(p.skills.join(', ')), '', 'role') : ''}
                ${bullets(p.bullets)}
            </div>`).join(''))}
        ${section('Education', r.education?.filter(e => e.school || e.degree).map(e => `
            <div class="item">
                ${line(esc(e.school), esc(e.years), 'head')}
                ${line(esc(e.degree), esc(e.location ?? ''), 'role')}
            </div>`).join(''))}
        ${section(certs.length ? 'Certifications & Skills' : 'Skills', skills.length || certs.length ? `<ul>
            ${skills.length ? `<li><strong>Skills:</strong> ${skills.map(esc).join('; ')}</li>` : ''}
            ${certs.length ? `<li><strong>Certifications:</strong> ${certs.map(esc).join('; ')}</li>` : ''}
        </ul>` : '')}
    </article>`
}

const resumeSuggestions = (s) => `
    <div class="section">
        <h2>Where to apply with this resume</h2>
        <p class="hint">${s.targetOccupation ? `Jobs for ${esc(s.targetOccupation)} first, then your` : 'Your'} strongest matches among recent postings.</p>
        <div class="grid two" style="margin-top:12px">${s.jobs.length ? s.jobs.map(j => `
            <div class="card job">
                <div class="card-head">
                    <div>
                        <div class="title">${esc(j.job.title)}</div>
                        <div class="meta">${esc(j.job.company)}${j.job.location ? ` · ${esc(j.job.location)}` : ''}</div>
                    </div>
                    <div class="score">${statusLabel(j.status)}<div class="pct">${j.score}%</div></div>
                </div>
                ${j.why.length ? `<div><div class="chip-label">You match on</div>${chips(j.why.map(name => ({ name })))}</div>` : ''}
                ${j.missing.length ? `<div><div class="chip-label">Missing</div>${chips(j.missing.map(name => ({ name })), 'miss')}</div>` : ''}
                ${j.job.url ? `<div><a href="${esc(j.job.url)}" target="_blank" rel="noopener noreferrer">View and apply</a>${attribution(j.job.attribution)}</div>` : ''}
            </div>`).join('') : '<div class="card"><p class="hint">No strong matches yet (Ready, or Close with at least a 50% match). The <a href="#/gap">Gap report</a> shows the one skill that would open the most jobs.</p></div>'}
        </div>
        ${s.occupations.length ? `<div class="card section"><h2>Occupations you fit best</h2>
            ${bars(s.occupations.map(o => ({ name: o.title, value: o.readiness / 100, label: `${o.readiness}%`, tip: `${o.title}: ${o.readiness}% ready` })), { max: 1 })}</div>` : ''}
        ${s.skillsToAdd.length ? `<div class="card section"><h2>Skills in your resume that are not on your profile</h2>
            <p class="hint">Matching only sees profile skills. Add the ones that are true for you.</p>
            <div class="chips">${s.skillsToAdd.map(k => `<button class="chip plain" data-action="resume-add-skill" data-id="${esc(k.id)}">+ ${esc(k.name)}</button>`).join('')}</div></div>` : ''}
    </div>`

// ---------------------------------------------------------------- admin: schools to onboard

export const unlistedSchools = (rows) => rows?.length ? `
    <div class="card section">
        <h2>Schools students typed in</h2>
        <p class="hint">Not on SkillBridge yet. Adding them (with programs and courses) gives these students course skills and their career office insights.</p>
        ${bars(rows.map(r => ({ name: r.schoolName, value: r.students, label: plural(r.students, 'student'), tip: `${r.schoolName}: ${plural(r.students, 'student')}` })))}
    </div>` : ''

// ---------------------------------------------------------------- student: mock interview

const FOCUS_NOTE = {
    STRETCH: 'You match part of this job, so the interviewer focuses on transferable skills and how you would close your gaps.',
    CLOSE: 'You are close to this job: expect questions that dig into your skills, one "tell me about a time" question, and one about a skill you are missing.',
    FULL: 'You match this job fully: this is a realistic final-round interview, with a high bar.'
}

export const interview = (state) => {
    const iv = state.interview
    if(iv.busy === 'starting') return `
        <h1>Mock interview</h1>
        <div class="card interview-wait"><div class="dots"><span></span><span></span><span></span></div>
            <p>Your interviewer is reading the job description and preparing questions…</p></div>`
    if(iv.current) return iv.current.status === 'FINISHED' && iv.current.report ? interviewReport(iv.current) : interviewRoom(state, iv.current)
    if(!iv.list) return loading('Mock interview')

    return `
    <h1>Mock interview</h1>
    <p class="sub">Practice with an AI interviewer who acts like an experienced HR recruiter. Questions come from the job's own
        description, and you get honest feedback at the end. Available for jobs you match at least ${INTERVIEW_MIN_SCORE}%.</p>
    <div class="grid tiles">
        ${tile('30–49% match', 'Stretch', 'Transferable skills, closing gaps')}
        ${tile('50–99% match', 'Close', 'Your skills in depth + one gap')}
        ${tile('100% match', 'Full', 'Realistic final round')}
    </div>
    <div class="card section">
        <h2>Start one</h2>
        <p class="hint">Press <strong>Practice interview</strong> on a job in <a href="#/matches">Job matches</a>,
            <a href="#/alerts">Job alerts</a>, or after <a href="#/jobcheck">checking a job link</a>.</p>
    </div>
    <h2 class="section">Your interviews</h2>
    ${iv.list.length ? `<div class="grid" style="margin-top:12px">${iv.list.map(s => `
        <div class="card job">
            <div class="card-head">
                <div>
                    <div class="title">${esc(s.job.title)}</div>
                    <div class="meta">${esc(s.job.company ?? '')} · ${s.score}% match · ${esc(fmtTime(s.createdAt))}</div>
                </div>
                <div class="score">${s.status === 'FINISHED'
                    ? `<div class="pct">${s.overall}/5</div><div class="hint">${esc(s.verdict ?? '')}</div>`
                    : '<span class="badge-soft">In progress</span>'}</div>
            </div>
            <div class="job-actions">
                <button type="button" class="small primary" data-action="open-interview" data-id="${esc(s.id)}">${s.status === 'FINISHED' ? 'See feedback' : 'Continue'}</button>
                <button type="button" class="link small" data-action="delete-interview" data-id="${esc(s.id)}">Delete</button>
            </div>
        </div>`).join('')}</div>`
    : '<div class="empty">No interviews yet.</div>'}`
}

const interviewRoom = (state, s) => {
    const busy = state.interview.busy
    const answered = new Set(s.messages.filter(m => m.role === 'candidate').map(m => m.q)).size
    const step = Math.min(s.currentIndex + 1, s.totalQuestions)
    return `
    <div class="interview-head">
        <button type="button" class="link small" data-action="interview-back">← All interviews</button>
        <h1>${esc(s.job.title)}</h1>
        <p class="sub">${s.job.company ? `${esc(s.job.company)} · ` : ''}${esc(s.focusLabel)}. ${esc(FOCUS_NOTE[s.focus])}</p>
        <div class="progress-row">
            <span>Question ${step} of ${s.totalQuestions}</span>
            ${meter(100 * answered / s.totalQuestions, { small: true, tip: `${answered} of ${s.totalQuestions} answered` })}
        </div>
    </div>
    <div class="card chat interview-chat">
        <div class="chat-log" id="chat-log" aria-live="polite">
            ${s.messages.map(m => `
                <div class="msg ${m.role === 'candidate' ? 'me' : 'bot'}">
                    ${m.role === 'interviewer' ? '<div class="who-label">Interviewer</div>' : ''}${esc(m.text)}
                </div>`).join('')}
            ${busy === 'answering' ? '<div class="msg bot thinking">The interviewer is listening…</div>' : ''}
            ${busy === 'finishing' ? '<div class="msg bot thinking">Preparing your feedback…</div>' : ''}
        </div>
        <form class="chat-form" data-form="interview-answer">
            <textarea name="answer" rows="4" maxlength="2000" required placeholder="Answer like you would in a real interview. Use a real example when you can (situation, what you did, the result)."
                data-ctrl-enter="interview-answer" ${busy ? 'disabled' : ''}></textarea>
            <div class="inline">
                <button type="submit" class="primary" ${busy ? 'disabled' : ''}>Send answer</button>
                <button type="button" data-action="interview-finish" ${busy || !answered ? 'disabled' : ''}>End and get feedback</button>
                <span class="hint">Ctrl+Enter sends</span>
            </div>
        </form>
    </div>`
}

const scoreDots = (n) => n == null
    ? '<span class="badge-soft">Not reached</span>'
    : `<span class="score-dots" aria-label="${n} out of 5">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</span>`

const interviewReport = (s) => {
    const r = s.report
    return `
    <div class="interview-head">
        <button type="button" class="link small" data-action="interview-back">← All interviews</button>
        <h1>Interview feedback</h1>
        <p class="sub">${esc(s.job.title)}${s.job.company ? ` at ${esc(s.job.company)}` : ''} · ${esc(s.focusLabel)}</p>
    </div>
    <div class="card hero">
        <div class="figure"><span data-count="${r.overall}">${r.overall}</span><small>/5</small></div>
        <div class="about">
            <h2>${esc(r.verdict)}</h2>
            ${meter(r.overall * 20, { tip: `${r.overall} out of 5` })}
            ${r.summary ? `<p style="margin:10px 0 0">${esc(r.summary)}</p>` : ''}
        </div>
    </div>
    <div class="grid two section">
        <div class="card"><h2>What went well</h2>
            ${r.strengths.length ? `<ul class="evidence">${r.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">—</p>'}</div>
        <div class="card"><h2>What to improve</h2>
            ${r.improvements.length ? `<ul class="evidence">${r.improvements.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">—</p>'}</div>
    </div>
    <h2 class="section">Question by question</h2>
    <div class="grid" style="margin-top:12px">${r.questions.map((q, i) => `
        <div class="card">
            <div class="card-head"><strong>${i + 1}. ${esc(q.question)}</strong>${scoreDots(q.score)}</div>
            ${q.score == null ? '<p class="hint">The interview ended before this question.</p>' : q.feedback ? `<p>${esc(q.feedback)}</p>` : ''}
            ${q.tip ? `<div class="notice tip"><strong>A stronger answer:</strong> ${esc(q.tip)}</div>` : ''}
        </div>`).join('')}
    </div>
    ${r.nextSteps.length ? `<div class="card section"><h2>Next steps</h2>
        <ul class="evidence">${r.nextSteps.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="hint">See the <a href="#/gap">Gap report</a> for free courses on missing skills.</p></div>` : ''}
    <div class="inline section">
        ${s.jobId ? `<button type="button" class="primary" data-action="start-interview" data-job-id="${esc(s.jobId)}">Practice again</button>` : ''}
        <button type="button" data-action="interview-back">All interviews</button>
    </div>
    <details class="card section transcript"><summary>Transcript</summary>
        ${s.messages.map(m => `<p><strong>${m.role === 'interviewer' ? 'Interviewer' : 'You'}:</strong> ${esc(m.text)}</p>`).join('')}
    </details>`
}
