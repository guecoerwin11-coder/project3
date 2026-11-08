import { describe, it, expect } from '@jest/globals'
import { classifyProviderError } from '../src/services/aiClient.js'

// Messages as the real provider sent them
describe('classifyProviderError', () => {
    it('recognizes an unknown model, with how to fix it', () => {
        process.env.AI_MODEL = 'agnes-2.5-flash'
        const p = classifyProviderError(400, 'The requested model is not available.')
        expect(p.kind).toBe('model')
        expect(p.fix).toMatch(/AI_MODEL "agnes-2.5-flash" is not offered/)
    })

    it('recognizes "no credits" whether it comes as 402 or 429', () => {
        expect(classifyProviderError(402, 'Insufficient credits. Please top up your balance.').kind).toBe('credits')
        expect(classifyProviderError(429, 'Insufficient credits. Please top up your balance and try again in a few minutes.').kind).toBe('credits')
    })

    it('keeps real rate limits and bad keys apart', () => {
        expect(classifyProviderError(429, 'Rate limit exceeded').kind).toBe('busy')
        expect(classifyProviderError(401, 'Invalid API key').kind).toBe('key')
        expect(classifyProviderError(500, 'Upstream error').kind).toBe('other')
    })
})
