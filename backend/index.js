import 'dotenv/config'
import app from './src/app.js'
import { startScheduler } from './src/services/scheduler.js'

if(!process.env.JWT_PASS){
    console.error('JWT_PASS is not set. Copy .env.example to .env and fill it in.')
    process.exit(1)
}

const PORT = process.env.PORT || 4100

app.listen(PORT, () => {
    console.log(`SkillBridge running on http://localhost:${PORT}`)
    console.log(`API docs:           http://localhost:${PORT}/api-docs`)
    // Automatic job sources and student alerts. SCHEDULER=off for a web-only instance.
    if(process.env.SCHEDULER !== 'off') startScheduler()
})
