import { describe, it, expect } from '@jest/globals'
import { buildMatcher, extractSkills } from '../src/services/skillExtractor.js'

const taxonomy = [
    { id: 'java', name: 'Java', aliases: [] },
    { id: 'js', name: 'JavaScript', aliases: ['js', 'ecmascript'] },
    { id: 'react', name: 'React', aliases: ['react.js', 'reactjs'] },
    { id: 'rn', name: 'React Native', aliases: [] },
    { id: 'csharp', name: 'C#', aliases: [] },
    { id: 'cpp', name: 'C++', aliases: [] },
    { id: 'node', name: 'Node.js', aliases: ['nodejs', 'node'] },
    { id: 'dotnet', name: '.NET', aliases: ['dotnet'] },
    { id: 'sql', name: 'SQL', aliases: [] },
    { id: 'mysql', name: 'MySQL', aliases: [] },
    { id: 'excel', name: 'Microsoft Excel', aliases: ['ms excel', 'excel', 'spreadsheets'] },
    { id: 'comm', name: 'Communication', aliases: ['communication skills', 'verbal and written communication'] },
    { id: 'cs', name: 'Customer Service', aliases: ['customer support'] },
    { id: 'git', name: 'Git', aliases: ['github', 'version control'] },
    { id: 'docker', name: 'Docker', aliases: [] },
    { id: 'r', name: 'R', aliases: ['r programming'] }
]
const matcher = buildMatcher(taxonomy)
const ids = (text) => extractSkills(text, matcher).map(s => s.skillId).sort()
const byId = (text) => Object.fromEntries(extractSkills(text, matcher).map(s => [s.skillId, s.importance]))

describe('extractSkills: finding skills', () => {
    it('does not confuse Java with JavaScript', () => {
        expect(ids('Strong JavaScript skills')).toEqual(['js'])
        expect(ids('Java and JavaScript')).toEqual(['java', 'js'])
    })

    it('handles symbols: C#, C++, Node.js, .NET', () => {
        expect(ids('Experience in C#, C++ and Node.js on .NET')).toEqual(['cpp', 'csharp', 'dotnet', 'node'])
    })

    it('prefers the longer skill: React Native is not also React', () => {
        expect(ids('Build apps in React Native')).toEqual(['rn'])
        expect(ids('React Native and ReactJS')).toEqual(['react', 'rn'])
    })

    it('matches aliases, case-insensitively', () => {
        expect(ids('Proficient in MS EXCEL and spreadsheets')).toEqual(['excel'])
        expect(ids('Good with GitHub')).toEqual(['git'])
    })

    it('does not match inside other words', () => {
        expect(ids('Responsible for sqlite migrations and nodes')).toEqual([])
        expect(ids('Must be excellent at reporting')).toEqual([])
    })

    it('skips one-letter names (R) but still finds their aliases', () => {
        expect(ids('Our R&D team, rated R')).toEqual([])
        expect(ids('R programming for statistics')).toEqual(['r'])
    })

    it('matches SQL and MySQL separately', () => {
        expect(ids('MySQL administration; SQL tuning')).toEqual(['mysql', 'sql'])
    })
})

describe('extractSkills: required vs preferred', () => {
    it('treats skills as required by default', () => {
        expect(byId('Must know SQL')).toEqual({ sql: 'REQUIRED' })
    })

    it('reads sections under a Preferred header as preferred', () => {
        const posting = `Qualifications:
- JavaScript
- Git
Preferred Qualifications
- Docker
- React`
        expect(byId(posting)).toEqual({ js: 'REQUIRED', git: 'REQUIRED', docker: 'PREFERRED', react: 'PREFERRED' })
    })

    it('reads "is a plus" / "an advantage" as preferred for that sentence only', () => {
        expect(byId('Strong SQL. Docker is a plus.')).toEqual({ sql: 'REQUIRED', docker: 'PREFERRED' })
        expect(byId('Knowledge of C# is an advantage; Java required')).toEqual({ csharp: 'PREFERRED', java: 'REQUIRED' })
    })

    it('handles inline headers: "Nice to have: Docker, React"', () => {
        expect(byId('Requirements: SQL\nNice to have: Docker, React')).toEqual({ sql: 'REQUIRED', docker: 'PREFERRED', react: 'PREFERRED' })
    })

    it('ignores benefits and about-us sections', () => {
        const posting = `About us
We build tools with Java.
Requirements
- SQL
Benefits
- Free Docker training`
        expect(byId(posting)).toEqual({ sql: 'REQUIRED' })
    })

    it('does not mistake a skill bullet for a section header', () => {
        const posting = `Requirements
- Excellent communication skills
- Customer support experience`
        expect(byId(posting)).toEqual({ comm: 'REQUIRED', cs: 'REQUIRED' })
    })

    it('keeps REQUIRED when a skill appears in both sections', () => {
        expect(byId('Requirements\n- Git\nPreferred\n- Git, Docker')).toEqual({ git: 'REQUIRED', docker: 'PREFERRED' })
    })
})
