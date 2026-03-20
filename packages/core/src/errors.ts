import type { ErrorResponse } from './schemas.js';

export function toPublicError(error: Error & { statusCode?: number }): ErrorResponse {
  const statusCode = error.statusCode ?? 500;

  // Don't leak internal error details in production
  const message = statusCode >= 500 ? 'Internal server error' : error.message;

  return {
    error: error.name || 'Error',
    message,
    statusCode,
  };
}
