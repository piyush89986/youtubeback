const logger = require('../utils/logger');
const { apiError } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  logger.error(`Error on ${req.method} ${req.originalUrl}: ${err.message}`, err.stack);

  // Multer Error Handling
  if (err.name === 'MulterError') {
    logger.error(`[Upload] Multer Error: ${err.code} - ${err.message} (field: ${err.field || 'none'})`);
    return apiError(res, `File upload error: ${err.message} (${err.code})`, 400);
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return apiError(res, 'Validation Error', 400, errors);
  }

  // Mongoose Duplicate Key Error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return apiError(res, `A record with that ${field} already exists.`, 409);
  }

  // Mongoose Bad ObjectId Cast
  if (err.name === 'CastError') {
    return apiError(res, `Resource not found with id: ${err.value}`, 404);
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return apiError(res, 'Invalid token signature.', 401);
  }

  const statusCode = err.statusCode || 500;
  const isVideoRoute = req.originalUrl && req.originalUrl.includes('/api/videos');
  const message = err.isOperational || process.env.NODE_ENV !== 'production' || isVideoRoute
    ? err.message
    : 'Internal server error';

  return apiError(res, message, statusCode);
};

// 404 Route Not Found
const notFoundHandler = (req, res) => {
  return apiError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
