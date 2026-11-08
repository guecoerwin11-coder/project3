// Thin client for an OpenAI-compatible chat completions API (NaraRouter, OpenRouter,
// OpenAI...). Configured from .env; when AI_API_KEY is missing the AI features are off
// and the rest of the app works as before.
import { InternalServer } from '../utils/errorClass.js'
import logger from '../logger/logger.js'

const TIMEOUT_MS = 60_000

const aiConfig = () => ({
    apiKey: process.env.AI_API_KEY,
    baseUrl: (process.env.AI_BASE_URL ?? '').replace(/\/+$/, ''),
    model: process.env.AI_MODEL
})

const aiEnabled = () => {
    const { apiKey, baseUrl, model } = aiConfig()
    return Boolean(apiKey && baseUrl && model)
}

class AiUnavailable extends Error{
    constructor(message){
        super(message)
        this.status = 503
        this.name = 'AI Unavailable Error'
    }
}

// Providers reuse status codes loosely (this one answers "no credits" with 402 OR 429),
// so the message text decides. `fix` goes to the server log for the admin.
const classifyProviderError = (status, providerMessage = '') => {
    const m = providerMessage.toLowerCase()
    if(/credit|balance|quota|billing|payment|top.?up/.test(m) || status === 402){
        return { kind: 'credits', fix: 'The AI provider account has no credits left: top up the balance with the provider.' }
    }
    if(/model/.test(m) && /not (available|found|exist|supported)|unknown|invalid/.test(m)){
        return { kind: 'model', fix: `AI_MODEL "${process.env.AI_MODEL}" is not offered by the provider: set AI_MODEL in .env to a model from GET ${aiConfig().baseUrl}/models.` }
    }
    if(status === 401 || status === 403) return { kind: 'key', fix: 'The AI provider rejected AI_API_KEY: check the key in .env.' }
    if(status === 429) return { kind: 'busy', fix: 'Rate limited by the AI provider: wait or raise the plan limit.' }
    return { kind: 'other', fix: `The AI provider returned HTTP ${status}; see its message.` }
}

// messages / tools in the OpenAI format; returns the first choice's message
const chatCompletion = async ({ messages, tools, temperature = 0.3, maxTokens = 1200 }) => {
    if(!aiEnabled()) throw new AiUnavailable('The AI assistant is not configured on this server')
    const { apiKey, baseUrl, model } = aiConfig()

    let res
    try{
        res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model, messages, temperature, max_tokens: maxTokens,
                ...(tools?.length && { tools, tool_choice: 'auto' })
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })
    }catch(err){
        throw new AiUnavailable(err.name === 'TimeoutError' ? 'The AI provider took too long to answer' : 'Cannot reach the AI provider')
    }

    const data = await res.json().catch(() => null)
    if(!res.ok){
        // Never echo the provider's error to the client: it can include account details.
        // The server log gets it, plus a plain "how to fix" for whoever runs the server.
        const providerMessage = String(data?.error?.message ?? '')
        const problem = classifyProviderError(res.status, providerMessage)
        logger.warn({ message: 'AI provider error', status: res.status, provider: providerMessage || null, fix: problem.fix, model })
        if(problem.kind === 'key') throw new InternalServer(`AI provider rejected the API key (${res.status})`)
        if(problem.kind === 'busy') throw new AiUnavailable('The AI assistant is busy, try again in a minute')
        // Wrong model, no credits, other provider-side setup: retrying will not help, and
        // the user cannot fix it, so say so plainly (details are in the server log)
        throw new AiUnavailable('The AI features are temporarily unavailable. Please try again later.')
    }
    const message = data?.choices?.[0]?.message
    if(!message) throw new AiUnavailable('The AI provider returned an empty answer')
    return message
}

export { aiEnabled, chatCompletion, AiUnavailable, classifyProviderError }
