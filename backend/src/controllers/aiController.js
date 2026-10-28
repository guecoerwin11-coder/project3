import { BadRequest } from '../utils/errorClass.js'
import { aiEnabled } from '../services/aiClient.js'
import { askAssistant } from '../services/assistantService.js'

const MAX_MESSAGES = 20      // the client sends the conversation; older turns are dropped
const MAX_MESSAGE_LENGTH = 2000

const getAiStatus = (req, res) => {
    res.status(200).json({ enabled: aiEnabled() })
}

// Stateless: the client keeps the conversation and sends it with each question
const chat = async (req, res, next) => {
    try{
        const { messages } = req.body ?? {}
        if(!Array.isArray(messages) || !messages.length) throw new BadRequest('messages must be a non-empty array')

        const history = messages.slice(-MAX_MESSAGES)
        for(const m of history){
            if(!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()){
                throw new BadRequest('Each message needs a role (user or assistant) and text content')
            }
            if(m.content.length > MAX_MESSAGE_LENGTH) throw new BadRequest(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters`)
        }
        if(history.at(-1).role !== 'user') throw new BadRequest('The last message must be from the user')

        const result = await askAssistant(req.user, history.map(({ role, content }) => ({ role, content })))
        res.status(200).json(result)
    }catch(err){
        next(err)
    }
}

export { getAiStatus, chat }
