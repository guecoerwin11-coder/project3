// Pure matching logic: no database, so every rule here is unit-tested.
//
// Skill hierarchy: a skill counts towards its broader parents. A student who knows
// MySQL satisfies a posting that asks for SQL; one who knows SQL does NOT satisfy
// a posting that asks for MySQL specifically.

const STATUS_ORDER = { READY: 0, CLOSE: 1, STRETCH: 2 }
const CLOSE_MAX_MISSING = 2
// A posting we only recognized one skill in ("Warehouse Supervisor: Excel") would
// otherwise show as a 100% READY match on almost no evidence
const MIN_JOB_SKILLS = 2

// Map(skillId -> [parentId, grandparentId, ...])
const buildAncestors = (skills) => {
    const parentOf = new Map(skills.map(s => [s.id, s.parentId ?? null]))
    const ancestors = new Map()
    for(const s of skills){
        const chain = []
        const seen = new Set([s.id])
        let p = parentOf.get(s.id)
        while(p && !seen.has(p)){ // guard against a cycle someone typed into the taxonomy
            chain.push(p)
            seen.add(p)
            p = parentOf.get(p)
        }
        ancestors.set(s.id, chain)
    }
    return ancestors
}

// Everything the skill set satisfies: the skills plus all their broader parents
const expandSkills = (skillIds, ancestors) => {
    const set = new Set()
    for(const id of skillIds){
        set.add(id)
        for(const a of ancestors.get(id) ?? []) set.add(a)
    }
    return set
}

const statusFor = (missingRequired) =>
    missingRequired === 0 ? 'READY' : missingRequired <= CLOSE_MAX_MISSING ? 'CLOSE' : 'STRETCH'

// jobSkills: [{ skillId, importance }]. Required skills weigh double.
const scoreJob = (has, jobSkills) => {
    const matchedRequired = [], missingRequired = [], matchedPreferred = [], missingPreferred = []
    for(const { skillId, importance } of jobSkills){
        const hit = has.has(skillId)
        if(importance === 'REQUIRED') (hit ? matchedRequired : missingRequired).push(skillId)
        else (hit ? matchedPreferred : missingPreferred).push(skillId)
    }

    // Too little was extracted from this posting to judge it fairly
    const requiredCount = matchedRequired.length + missingRequired.length
    if(requiredCount === 0 || jobSkills.length < MIN_JOB_SKILLS) return null

    const total = 2 * requiredCount + matchedPreferred.length + missingPreferred.length

    return {
        score: Math.round(100 * (2 * matchedRequired.length + matchedPreferred.length) / total),
        status: statusFor(missingRequired.length),
        matchedRequired, missingRequired, matchedPreferred, missingPreferred
    }
}

// jobs: [{ id, skills: [{ skillId, importance }], ... }]
const rankJobs = (has, jobs) => jobs
    .map(job => ({ job, match: scoreJob(has, job.skills) }))
    .filter(r => r.match)
    .sort((a, b) =>
        STATUS_ORDER[a.match.status] - STATUS_ORDER[b.match.status] ||
        b.match.score - a.match.score ||
        // Same score: the match backed by more skills is the stronger one
        b.match.matchedRequired.length - a.match.matchedRequired.length ||
        b.job.postedAt - a.job.postedAt)

// "Learn X and N more jobs become reachable."
// Simulates adding each missing required skill (plus its parents) and counts
// jobs that move to READY, and STRETCH jobs that move to CLOSE.
const nextBestSkills = (studentSkillIds, jobs, ancestors, limit = 5) => {
    const has = expandSkills(studentSkillIds, ancestors)
    const before = jobs.map(job => ({ job, match: scoreJob(has, job.skills) })).filter(r => r.match)

    const candidates = new Set()
    for(const { match } of before) for(const id of match.missingRequired) candidates.add(id)

    const results = []
    for(const candidate of candidates){
        const gained = expandSkills([candidate], ancestors)
        let newlyReady = 0, newlyClose = 0
        for(const { job, match } of before){
            if(match.status === 'READY') continue
            const stillMissing = match.missingRequired.filter(id => !gained.has(id)).length
            if(stillMissing === match.missingRequired.length) continue
            const after = statusFor(stillMissing)
            if(after === 'READY') newlyReady++
            else if(after === 'CLOSE' && match.status === 'STRETCH') newlyClose++
        }
        if(newlyReady || newlyClose) results.push({ skillId: candidate, newlyReady, newlyClose })
    }
    return results
        .sort((a, b) => b.newlyReady - a.newlyReady || b.newlyClose - a.newlyClose)
        .slice(0, limit)
}

// How often each skill is asked for across a set of postings.
// share = (required + 0.5 * preferred) / number of postings
const demandProfile = (jobs) => {
    const counts = new Map()
    let n = 0
    for(const job of jobs){
        if(!job.skills.length) continue
        n++
        for(const { skillId, importance } of job.skills){
            const c = counts.get(skillId) ?? { skillId, required: 0, preferred: 0 }
            importance === 'REQUIRED' ? c.required++ : c.preferred++
            counts.set(skillId, c)
        }
    }
    const profile = [...counts.values()]
        .map(c => ({ ...c, share: n ? (c.required + 0.5 * c.preferred) / n : 0 }))
        .sort((a, b) => b.share - a.share)
    return { postings: n, profile }
}

// Demand-weighted coverage, 0-100, plus the demanded skills that are missing
const coverage = (has, profile, minShare = 0) => {
    const relevant = profile.filter(p => p.share >= minShare)
    const total = relevant.reduce((s, p) => s + p.share, 0)
    const covered = relevant.filter(p => has.has(p.skillId))
    const missing = relevant.filter(p => !has.has(p.skillId))
    return {
        percent: total ? Math.round(100 * covered.reduce((s, p) => s + p.share, 0) / total) : 0,
        covered,
        missing
    }
}

// Greedy set cover: pick the resource covering the most (weighted) missing skills,
// then the next one for whatever is still uncovered. Avoids recommending three
// courses that all teach the same thing.
// gaps: [{ skillId, share }]; resources: [{ id, hours, free, skillIds: [] }]
const recommendResources = (gaps, resources, limit = 4) => {
    const weight = new Map(gaps.map(g => [g.skillId, g.share]))
    const uncovered = new Set(weight.keys())
    const picked = []

    while(picked.length < limit && uncovered.size){
        let best = null
        for(const r of resources){
            if(picked.some(p => p.id === r.id)) continue
            const covers = r.skillIds.filter(id => uncovered.has(id))
            if(!covers.length) continue
            const value = covers.reduce((s, id) => s + weight.get(id), 0)
            const better = !best ||
                value > best.value + 1e-9 ||
                (Math.abs(value - best.value) < 1e-9 && (r.free && !best.r.free ||
                    (r.free === best.r.free && (r.hours ?? Infinity) < (best.r.hours ?? Infinity))))
            if(better) best = { r, covers, value }
        }
        if(!best) break
        picked.push({ ...best.r, covers: best.covers })
        for(const id of best.covers) uncovered.delete(id)
    }
    return picked
}

export {
    STATUS_ORDER, CLOSE_MAX_MISSING, MIN_JOB_SKILLS,
    buildAncestors, expandSkills, scoreJob, rankJobs, nextBestSkills,
    demandProfile, coverage, recommendResources
}
