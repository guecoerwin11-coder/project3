export class ApiError extends Error {
    constructor(status, message){
        super(message)
        this.status = status
    }
}

const TOKEN_KEY = 'skillbridge.session'

export const session = {
    get(){
        try{ return JSON.parse(localStorage.getItem(TOKEN_KEY)) }catch{ return null }
    },
    set(value){
        try{ localStorage.setItem(TOKEN_KEY, JSON.stringify(value)) }catch{ /* private mode: session lasts this tab only */ }
    },
    clear(){
        try{ localStorage.removeItem(TOKEN_KEY) }catch{ /* ignore */ }
    }
}

export const api = async (path, { method = 'GET', body } = {}) => {
    const token = session.get()?.token
    let res
    try{
        res = await fetch(`/api${path}`, {
            method,
            headers: {
                ...(body !== undefined && { 'Content-Type': 'application/json' }),
                ...(token && { Authorization: `Bearer ${token}` })
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        })
    }catch{
        throw new ApiError(0, 'Cannot reach the server')
    }
    let data = null
    try{ data = await res.json() }catch{ /* empty body */ }
    if(!res.ok) throw new ApiError(res.status, data?.error?.message || `Request failed (${res.status})`)
    return data
}
