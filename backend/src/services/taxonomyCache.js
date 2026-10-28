import prisma from '../configs/postgres.js'
import { buildMatcher } from './skillExtractor.js'
import { buildAncestors } from './matching.js'
import { buildClassifier } from './postingNormalizer.js'

// Building the matcher compiles a regex per alias, so it is built once and
// reused until the taxonomy or occupations change.
let cache = null

const getTaxonomy = async () => {
    if(cache) return cache
    const [skills, occupations] = await Promise.all([
        prisma.skill.findMany({ select: { id: true, name: true, aliases: true, parentId: true, category: true } }),
        prisma.occupation.findMany({ select: { id: true, title: true, titleKeywords: true } })
    ])
    cache = {
        skills,
        skillById: new Map(skills.map(s => [s.id, s])),
        matcher: buildMatcher(skills),
        ancestors: buildAncestors(skills),
        classify: buildClassifier(occupations),
        occupations
    }
    return cache
}

const invalidateTaxonomy = () => { cache = null }

export { getTaxonomy, invalidateTaxonomy }
