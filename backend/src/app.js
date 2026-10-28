import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import swaggerUi from 'swagger-ui-express'
import authRouter from './routes/authRoute.js'
import catalogRouter from './routes/catalogRoute.js'
import profileRouter from './routes/profileRoute.js'
import jobRouter from './routes/jobRoute.js'
import aiRouter from './routes/aiRoute.js'
import liveRouter from './routes/liveRoute.js'
import careerRouter from './routes/careerRoute.js'
import errorHandler from './middleware/errorHandler.js'
import swaggerSpec from './configs/swagger.js'
import { NotFound } from './utils/errorClass.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// Job imports can carry a couple of thousand postings
app.use(express.json({ limit: '10mb' }))

// API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))
app.use('/api', authRouter)
app.use('/api', catalogRouter)
app.use('/api', profileRouter)
app.use('/api', jobRouter)
app.use('/api', aiRouter)
app.use('/api', liveRouter)
app.use('/api', careerRouter)
app.use('/api', (req, res, next) => next(new NotFound(`No route for ${req.method} ${req.originalUrl}`)))

// The web app, same origin so it needs no CORS
app.use(express.static(path.join(__dirname, '../../frontend')))

// Error handler must be registered after all routes
app.use(errorHandler)

export default app
