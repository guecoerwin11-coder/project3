import { analyzeJob, writeCoverLetter } from '../services/jobLinkService.js'
import { getResume, buildResume } from '../services/resumeService.js'
import {
    startInterview, listInterviews, getInterview, answerInterview, finishInterview, deleteInterview
} from '../services/interviewService.js'

// { url } or { text, title?, company? }
const checkJob = async (req, res, next) => {
    try{
        res.status(200).json(await analyzeJob(req.user, req.body))
    }catch(err){
        next(err)
    }
}

// { posting: { title, company, description } }
const coverLetter = async (req, res, next) => {
    try{
        res.status(200).json(await writeCoverLetter(req.user, req.body?.posting))
    }catch(err){
        next(err)
    }
}

const showResume = async (req, res, next) => {
    try{
        res.status(200).json(await getResume(req.user))
    }catch(err){
        next(err)
    }
}

const saveResume = async (req, res, next) => {
    try{
        res.status(200).json(await buildResume(req.user, req.body?.input))
    }catch(err){
        next(err)
    }
}

// ---------- mock interviews ----------

const handle = (fn, status = 200) => async (req, res, next) => {
    try{
        res.status(status).json(await fn(req))
    }catch(err){
        next(err)
    }
}

// { jobId } or { posting: { title, company, description, url } }
const startMockInterview = handle(req => startInterview(req.user, req.body), 201)
const listMockInterviews = handle(async req => ({ data: await listInterviews(req.user) }))
const showMockInterview = handle(req => getInterview(req.user, req.params.id))
const answerMockInterview = handle(req => answerInterview(req.user, req.params.id, req.body?.answer))
const finishMockInterview = handle(req => finishInterview(req.user, req.params.id))
const deleteMockInterview = handle(async req => {
    await deleteInterview(req.user, req.params.id)
    return { message: 'interview deleted' }
})

export {
    checkJob, coverLetter, showResume, saveResume,
    startMockInterview, listMockInterviews, showMockInterview, answerMockInterview, finishMockInterview, deleteMockInterview
}
