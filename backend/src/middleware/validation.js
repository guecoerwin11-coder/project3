import jwt from 'jsonwebtoken'
import { Unauthorized } from '../utils/errorClass.js'

// Verifies the Bearer token and puts the decoded user on req.user
const validation = (req, res, next) => {
    try{
        const authHead = req.headers.authorization;

        if(!authHead || !authHead.startsWith('Bearer ')){
            throw new Unauthorized("Missing or invalid authorization header")
        }

        const token = authHead.split(' ')[1];
        req.user = jwt.verify(token, process.env.JWT_PASS)
        next()
    }catch(err){
        if(err instanceof Unauthorized){
            return next(err)
        }
        next(new Unauthorized("Invalid Token or Expired Token"))
    }
}

export default validation
