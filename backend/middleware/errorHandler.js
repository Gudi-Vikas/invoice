/**
 * Global Express Error Handling Middleware.
 * Standardizes API error outputs and intercepts known database errors to prevent internal leakage.
 */
export const errorHandler = (err, req, res, next) => {
  console.error('API Error details:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Unique constraint violation in PostgreSQL (code: 23505)
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict: A record with duplicate unique fields already exists.',
      details: err.detail
    });
  }

  // Row-Level Security policy violation or constraint check failure
  if (err.code === '42501') {
    return res.status(403).json({
      error: 'Access denied: Database security policies prevent execution of this query.'
    });
  }

  // Foreign key violation in PostgreSQL (code: 23503)
  if (err.code === '23503') {
    return res.status(400).json({
      error: 'Bad Request: Relational reference integrity check failed.',
      details: err.detail
    });
  }

  // Custom client validation error
  if (err.name === 'ValidationError' || err.status === 400) {
    return res.status(400).json({
      error: err.message || 'Validation error: Input data verification failed.'
    });
  }

  // Fallback for generic server error
  return res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error: Something went wrong in the system.'
  });
};

export default errorHandler;
