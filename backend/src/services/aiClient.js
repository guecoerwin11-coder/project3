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
        // The server log gets it, since it usually says what to fix (quota, account setup...)
        logger.warn({ message: 'AI provider error', status: res.status, provider: data?.error?.message ?? null })
        if(res.status === 401 || res.status === 403) throw new InternalServer(`AI provider rejected the API key (${res.status})`)
        if(res.status === 429) throw new AiUnavailable('The AI assistant is busy, try again in a minute')
        throw new AiUnavailable(`The AI provider returned an error (${res.status})`)
    }
    const message = data?.choices?.[0]?.message
    if(!message) throw new AiUnavailable('The AI provider returned an empty answer')
    return message
}

export { aiEnabled, chatCompletion, AiUnavailable }
