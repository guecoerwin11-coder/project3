import swaggerJsdoc from 'swagger-jsdoc'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const errorResponse = (description) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
})

const options = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'SkillBridge API',
            version: '1.0.0',
            description: 'Maps student skills to real job postings, shows the gap, and tells schools what their programs are missing'
        },
        servers: [{ url: '/api', description: 'This server' }],
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
            },
            schemas: {
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: {
                            type: 'object',
                            properties: { message: { type: 'string' }, status: { type: 'integer' } }
                        }
                    }
                }
            },
            responses: {
                BadRequest: errorResponse('Invalid input'),
                Unauthorized: errorResponse('Missing, invalid or expired token'),
                Forbidden: errorResponse('Not allowed for this role'),
                NotFound: errorResponse('Not found'),
                Conflict: errorResponse('Already exists')
            }
        }
    },
    // Scan route files for @openapi JSDoc comments
    apis: [path.join(__dirname, '../routes/*.js').split(path.sep).join('/')]
}

export default swaggerJsdoc(options)
