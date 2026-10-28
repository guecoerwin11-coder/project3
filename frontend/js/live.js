// Keeps one Server-Sent Events connection open while logged in.
// Tickets are single-use, so after a drop it fetches a new one and reconnects,
// waiting a little longer each time (1 s, 2 s, 4 s... up to 30 s).
import { api, ApiError } from './api.js'

export const connectLive = (handlers) => {
    let source = null
    let stopped = false
    let delay = 1000
    let timer = null

    const retry = () => {
        if(stopped) return
        timer = setTimeout(open, delay)
        delay = Math.min(delay * 2, 30000)
    }

    const on = (name, fn) => source.addEventListener(name, (e) => {
        try{ fn?.(JSON.parse(e.data)) }catch{ /* ignore a malformed event */ }
    })

    const open = async () => {
        if(stopped) return
        try{
            const { ticket } = await api('/stream/ticket', { method: 'POST' })
            source = new EventSource(`/api/stream?ticket=${encodeURIComponent(ticket)}`)
            on('hello', (data) => {
                delay = 1000
                handlers.status?.(true)
                handlers.hello?.(data)
            })
            on('match', handlers.match)
            on('activity', handlers.activity)
            source.onerror = () => {
                source.close()
                handlers.status?.(false)
                retry()
            }
        }catch(err){
            handlers.status?.(false)
            // Logged out or token expired: stop instead of retrying forever
            if(err instanceof ApiError && err.status === 401) return
            retry()
        }
    }

    open()
    return () => {
        stopped = true
        clearTimeout(timer)
        source?.close()
    }
}
