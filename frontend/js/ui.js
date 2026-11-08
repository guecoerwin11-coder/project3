export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]))

export const pct = (share) => `${Math.round(share * 100)}%`
export const fmtNum = (n) => Number(n ?? 0).toLocaleString()
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'
export const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`

export const toast = (message, kind = '') => {
    const el = document.createElement('div')
    el.className = `toast ${kind}`
    el.textContent = message
    document.getElementById('toasts').append(el)
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500)
}

// ---------- status: reserved colors, always icon + label ----------
const STATUS = {
    READY: { color: 'var(--good)', label: 'Ready', icon: '<path d="M5 10.5l3 3 7-7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    CLOSE: { color: 'var(--warning)', label: 'Close', icon: '<path d="M10 5.5v5M10 14h.01" stroke="#0b0b0b" stroke-width="2.2" stroke-linecap="round"/>' },
    STRETCH: { color: 'var(--serious)', label: 'Stretch', icon: '<path d="M6 10h8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' }
}
export const statusLabel = (status, suffix = '') => {
    const s = STATUS[status]
    return `<span class="status"><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="${s.color}"/>${s.icon}</svg>${esc(s.label)}${suffix}</span>`
}

// ---------- meter: fill on a lighter step of the same ramp ----------
export const meter = (percent, { small = false, tip = '' } = {}) => `
    <div class="meter ${small ? 'small' : ''}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"
        ${tip ? `data-tip="${esc(tip)}"` : ''}>
        <span style="width:${Math.max(0, Math.min(100, percent))}%"></span>
    </div>`

// ---------- single-series horizontal bars ----------
// rows: [{ name, value (0..1 or count), label, tip, extra }]; max scales the bars
export const bars = (rows, { max = null, empty = 'Nothing to show.' } = {}) => {
    if(!rows.length) return `<div class="empty">${esc(empty)}</div>`
    const top = max ?? Math.max(...rows.map(r => r.value), 0.0001)
    return `<div class="bars">${rows.map((r, i) => `
        <div class="bar-row" tabindex="0" style="--i:${Math.min(i, 12)}" data-tip="${esc(r.tip ?? `${r.name}: ${r.label}`)}">
            <div class="name">${esc(r.name)}</div>
            <div class="track">
                <div class="fill" style="width:${Math.max(0.5, 100 * r.value / top) * 0.82}%"></div>
                <span class="val">${esc(r.label)}</span>
            </div>
            ${r.extra ? `<div class="extra">${esc(r.extra)}</div>` : ''}
        </div>`).join('')}</div>`
}

// Whole numbers ("26", "65%") count up when shown; mixed text ("0 of 12") stays as is
export const tile = (label, value, note = '') => {
    const m = String(value).match(/^(\d+)(%?)$/)
    const shown = m ? `<span data-count="${m[1]}">${esc(m[1])}</span>${m[2]}` : esc(value)
    return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${shown}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts [data-count] numbers up from 0 (ease-out, 700 ms). The final value is already
// in the HTML, so screen readers and no-JS/reduced-motion users simply see the number.
export const animateNumbers = (root) => {
    if(!root || prefersReducedMotion()) return
    for(const el of root.querySelectorAll('[data-count]:not([data-counted])')){
        const target = Number(el.dataset.count)
        el.dataset.counted = '1'
        if(!Number.isFinite(target) || target === 0) continue
        const start = performance.now()
        const step = (now) => {
            const t = Math.min(1, (now - start) / 700)
            el.textContent = Math.round(target * (1 - (1 - t) ** 3))
            if(t < 1) requestAnimationFrame(step)
        }
        el.textContent = '0'
        requestAnimationFrame(step)
    }
}

export const chips = (skills, cls = '') => skills.length
    ? `<div class="chips">${skills.map(s => `<span class="chip ${cls}">${esc(s.name)}</span>`).join('')}</div>`
    : ''

// ---------- tooltip (hover and keyboard focus) ----------
export const installTooltips = () => {
    const tip = document.getElementById('tooltip')
    const show = (el, x, y) => {
        tip.textContent = el.dataset.tip
        tip.hidden = false
        const r = tip.getBoundingClientRect()
        tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 14)}px`
        tip.style.top = `${Math.min(window.innerHeight - r.height - 8, y + 14)}px`
    }
    document.addEventListener('mousemove', (e) => {
        const el = e.target.closest?.('[data-tip]')
        if(el) show(el, e.clientX, e.clientY)
        else tip.hidden = true
    })
    document.addEventListener('focusin', (e) => {
        const el = e.target.closest?.('[data-tip]')
        if(!el) return
        const r = el.getBoundingClientRect()
        show(el, r.left, r.bottom - 10)
    })
    document.addEventListener('focusout', () => { tip.hidden = true })
}

// The SkillBridge bridge (the original mark), in the app's red
export const LOGO = `<svg class="logo" width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#e73125"/><g class="mark"><path d="M5 21c5-8 17-8 22 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M9 21v4M23 21v4M16 15v10" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g></svg>`
