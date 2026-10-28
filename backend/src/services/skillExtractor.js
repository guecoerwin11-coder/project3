// Finds taxonomy skills in free text (job postings, project descriptions) and
// decides whether each one is REQUIRED or PREFERRED from where it appears.
//
// Why a dictionary and not "split into words": skills are multi-word ("customer
// service"), contain symbols ("C#", "Node.js", ".NET"), and are written many ways
// ("MS Excel", "spreadsheets"). Each skill lists its aliases in the taxonomy.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Section headers that change how the lines under them are read
const HEADER = {
    preferred: /\b(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|advantage|desirable|plus points?)\b/,
    ignore: /\b(about (us|the company|the role)|who we are|benefits|perks|what we offer|why (join|work)|compensation)\b/,
    required: /\b(requirements?|qualifications?|must[\s-]haves?|what you(?:'ll)? need|you have|skills|responsibilities|duties|what you(?:'ll)? do|the role)\b/
}
// A sentence that softens itself: "Python is a plus", "SAP experience preferred"
const SOFT_CUE = /\b(is an? (plus|advantage|bonus)|are an? (plus|advantage|bonus)|preferred|nice to have|good to have|would be (great|nice|an advantage)|desirable|optional)\b/

const MAX_HEADER_LENGTH = 60

const normalize = (text) => String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')

// Builds a reusable matcher from the taxonomy: [{ id, name, aliases }]
const buildMatcher = (skills) => {
    const terms = []
    for(const skill of skills){
        const variants = new Set([skill.name, ...(skill.aliases ?? [])].map(t => normalize(t).trim()).filter(Boolean))
        for(const term of variants){
            // Single letters ("R", "C") match far too much free text; give them an alias instead
            if(term.length < 2) continue
            terms.push({
                skillId: skill.id,
                term,
                // Not glued to other letters/digits; "+" and "#" after count as part of the word (C++, C#)
                re: new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9+#])`, 'g')
            })
        }
    }
    // Longest first, so "react native" is taken before "react", "customer service" before "service"
    terms.sort((a, b) => b.term.length - a.term.length)
    return { terms }
}

const splitSentences = (line) => line.split(/;|(?<=[.!?])\s+(?=[a-z])/)

const containsSkill = (text, matcher) => matcher.terms.some(({ term, re }) => {
    if(!text.includes(term)) return false
    re.lastIndex = 0
    return re.test(text)
})

// A short line like "Preferred Qualifications" or "Benefits:" switches the section.
// "Excellent communication skills" is NOT a header even though it says "skills":
// real headers never contain a skill from the taxonomy.
const headerMode = (text, matcher) => {
    const bare = text.replace(/^[\s#*\-•·>]+/, '').replace(/:\s*$/, '').trim()
    if(!bare || bare.length > MAX_HEADER_LENGTH || /[.,;]/.test(bare) || bare.split(/\s+/).length > 6) return null
    if(containsSkill(bare, matcher)) return null
    // Order matters: "Preferred qualifications" is preferred, not required
    if(HEADER.preferred.test(bare)) return 'PREFERRED'
    if(HEADER.ignore.test(bare)) return 'IGNORE'
    if(HEADER.required.test(bare)) return 'REQUIRED'
    return null
}

// Returns [{ skillId, importance, term }], one entry per skill.
// A skill seen as both required and preferred is REQUIRED.
const extractSkills = (text, matcher) => {
    const found = new Map()
    let mode = 'REQUIRED'

    for(const rawLine of normalize(text).split(/\r?\n/)){
        let line = rawLine.trim()
        if(!line) continue

        // Inline header: "Nice to have: Python, Docker"
        const colon = line.indexOf(':')
        const inline = colon > 0 && colon <= 40 ? headerMode(line.slice(0, colon), matcher) : null
        if(inline){
            mode = inline
            line = line.slice(colon + 1).trim()
            if(!line) continue
        }else{
            const header = headerMode(line, matcher)
            if(header){
                mode = header
                continue
            }
        }
        if(mode === 'IGNORE') continue

        for(const sentence of splitSentences(line)){
            const importance = mode === 'PREFERRED' || SOFT_CUE.test(sentence) ? 'PREFERRED' : 'REQUIRED'
            let rest = sentence

            for(const { skillId, term, re } of matcher.terms){
                if(!rest.includes(term)) continue
                re.lastIndex = 0
                let hit = false
                rest = rest.replace(re, (m) => {
                    hit = true
                    return ' '.repeat(m.length) // mask it so shorter terms can't match inside
                })
                if(!hit) continue

                const prev = found.get(skillId)
                if(!prev || (prev.importance === 'PREFERRED' && importance === 'REQUIRED')){
                    found.set(skillId, { skillId, importance, term })
                }
            }
        }
    }
    return [...found.values()]
}

export { buildMatcher, extractSkills, normalize }
