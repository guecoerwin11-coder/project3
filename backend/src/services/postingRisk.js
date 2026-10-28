// Red flags in a hiring post, checked without AI so a scam is caught even when the
// model misses it. Pure, so every rule here is unit-tested.
//
// Risk levels: LOW is published automatically; MEDIUM and HIGH wait for an admin.

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 }
const maxRisk = (...levels) => levels.reduce((a, b) => (RISK_ORDER[b] > RISK_ORDER[a] ? b : a), 'LOW')

// "P2,500/day", "php 15000 per week", "₱3,000 kada araw"
const PAY_RE = /(?:₱|\bphp|\bp)\s?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:\/|per|a|kada)\s*(day|araw|week|linggo)\b/g
// About 4-5x the NCR minimum wage: entry-level jobs rarely pay this, scam posts often promise it
const HIGH_PAY = { day: 3000, week: 15000 }

const RULES = [
    {
        risk: 'HIGH',
        reason: 'Asks applicants to pay a fee',
        re: /\b(processing|placement|application|training|reservation|registration|medical|uniform|deployment|seminar|id) fees?\b|\bpay (a |the )?(small )?fee\b|\b(fee|deposit|payment) (is )?(required|needed) (before|to (apply|start|reserve))/
    },
    {
        risk: 'HIGH',
        reason: 'Asks for passwords, OTPs or bank details',
        re: /\b(otp|one[\s-]time (pin|password)|your password|bank account (number|details)|atm (card|pin)|card number|cvv)\b/
    },
    {
        risk: 'MEDIUM',
        reason: 'Asks for payment through e-wallet or remittance',
        re: /\b(send|pay|transfer|deposit)\b.{0,40}\b(gcash|maya|paymaya|palawan|cebuana|western union|remittance)\b/
    },
    {
        risk: 'MEDIUM',
        reason: 'Promises unusually high daily or weekly pay',
        test: (text) => [...text.matchAll(PAY_RE)].some(([, amount, unit]) => {
            const n = Number(amount.replace(/,/g, ''))
            return /day|araw/.test(unit) ? n >= HIGH_PAY.day : n >= HIGH_PAY.week
        })
    },
    {
        risk: 'MEDIUM',
        reason: 'Overseas job: check the agency is POEA/DMW licensed',
        re: /\b(abroad|overseas|ofw|deployment to|direct hire)\b/
    }
]

// posting: { title, company, description }; returns { risk, reasons }
const ruleFlags = (posting) => {
    const text = `${posting.title ?? ''}\n${posting.company ?? ''}\n${posting.description ?? ''}`.toLowerCase()
    const hits = RULES.filter(r => (r.test ? r.test(text) : r.re.test(text)))
    return { risk: maxRisk(...hits.map(h => h.risk)), reasons: hits.map(h => h.reason) }
}

const words = (s) => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}#+.]{3,}/gu) ?? []

// Share of the description's words that also appear in the pasted text. Low means the
// model rewrote or invented content, and invented requirements would skew matching.
const groundedShare = (description, source) => {
    const pool = new Set(words(source))
    const used = words(description)
    if(!used.length) return 0
    return used.filter(w => pool.has(w)).length / used.length
}

export { RISK_ORDER, maxRisk, ruleFlags, groundedShare }
