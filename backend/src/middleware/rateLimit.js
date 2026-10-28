// Per-user fixed-window rate limit, kept in memory. Enough for one server process;
// use a shared store (Redis) if the app ever runs on several.
// Usage: router.post('/ai/chat', validation, rateLimit({ max: 30, windowMs: 3600000 }), handler)
// Must run AFTER the validation middleware, which puts the decoded token on req.user.

class TooManyRequests extends Error{
    constructor(message){
        super(message)
        this.status = 429
        this.name = 'Too Many Requests Error'
    }
}

const rateLimit = ({ max, windowMs }) => {
    const hits = new Map() // userId -> { count, resetAt }

    return (req, res, next) => {
        const now = Date.now()
        const key = req.user?.id ?? req.ip
        let entry = hits.get(key)
        if(!entry || entry.resetAt <= now){
            entry = { count: 0, resetAt: now + windowMs }
            hits.set(key, entry)
        }
        if(entry.count >= max){
            const minutes = Math.ceil((entry.resetAt - now) / 60000)
            res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
            return next(new TooManyRequests(`Limit reached. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`))
        }
        entry.count++

        // Drop expired entries now and then so the map does not grow forever
        if(hits.size > 1000) for(const [k, e] of hits) if(e.resetAt <= now) hits.delete(k)
        next()
    }
}

export default rateLimit
