import logger from "../logger/logger.js";

const errorHandler = (err, req, res, next) => {
    // express.json() throws a SyntaxError with status 400 for a malformed body
    const status = err.status || 500;
    const message = err.message || "Internal Server Error"

    const errorLog = {
        message: err.message,
        status,
        name: err.name,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userId: req.user?.id || 'anonymous',
        stack: err.stack
    };

    if (status >= 500) {
        logger.error(errorLog);
    } else {
        logger.warn(errorLog);
    }

    const errorResponse = {
        success: false,
        error: {
            message,
            status
        }
    };

    if (process.env.NODE_ENV === 'development') {
        errorResponse.error.name = err.name;
    }

    // Don't expose internals on unexpected errors outside development
    if (status === 500 && process.env.NODE_ENV !== 'development') {
        errorResponse.error.message = 'Internal server error. Contact support.';
    }

    res.status(status).json(errorResponse);
}
export default errorHandler
