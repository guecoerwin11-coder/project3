import { analyzeJob, writeCoverLetter } from '../services/jobLinkService.js'
import { getResume, buildResume } from '../services/resumeService.js'

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

export { checkJob, coverLetter, showResume, saveResume }
