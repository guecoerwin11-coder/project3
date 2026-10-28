import winston from 'winston'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const logs = path.join(__dirname, '../../logs')

//if no folder named logs this will create
if(!fs.existsSync(logs)){
    fs.mkdirSync(logs);
}

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
)

const logger = winston.createLogger({
    level: "info",
    format: fileFormat,
    defaultMeta: {service: 'skillbridge-api'},
    transports: [
        new winston.transports.File({
            filename: path.join(logs, 'error.log'),
            level: 'error',
            maxsize: 5242880,
            maxFiles: 10
        }),
        new winston.transports.File({
            filename: path.join(logs, 'warning.log'),
            level: 'warn',
            maxsize: 5242880,
            maxFiles: 10
        }),
        // Combined logs (all levels)
        new winston.transports.File({
            filename: path.join(logs, 'combined.log'),
            maxsize: 5242880,
            maxFiles: 10
        })
    ]
});

export default logger
