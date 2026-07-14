const ApiError = require('../utils/ApiError');

const GENERIC_CAST_MESSAGE = 'Submitted data is in invalid form, please use proper data';

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  // Mongoose validation error — may contain nested CastErrors (e.g. array
  // passed for a String field). Never surface the raw Mongoose message because
  // it leaks internal field names and type information.
  if (err.name === 'ValidationError') {
    const hasCastError = Object.values(err.errors).some(
      (e) => e.name === 'CastError' || e.kind === 'string'
    );
    const message = hasCastError
      ? GENERIC_CAST_MESSAGE
      : Object.values(err.errors).map((e) => e.message).join(', ');
    error = new ApiError(400, message);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = new ApiError(409, `An account with this ${field} already exists`);
  }

  // Mongoose CastError (e.g. bad ObjectId in route param, or top-level type mismatch)
  if (err.name === 'CastError') {
    error = new ApiError(400, GENERIC_CAST_MESSAGE);
  }

  if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Invalid token');
  }
  if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Token expired');
  }

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong. Please try again.';

  if (process.env.NODE_ENV !== 'production' && !error.isOperational) {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(error.details ? { details: error.details } : {}),
    ...(process.env.NODE_ENV !== 'production' && !error.isOperational
      ? { stack: err.stack }
      : {}),
  });
};

module.exports = errorHandler;
