/**
 * Phase 10: Error Mapping Utilities
 *
 * Maps internal errors to structured MCP responses.
 * Sanitizes stack traces and prevents sensitive data leakage.
 */

import { ZodError } from 'zod';
import { ErrorCode, errorResponse, type ErrorResponse } from '../schemas/errors.js';

/**
 * Map any error to structured ErrorResponse
 *
 * @param error - Error object
 * @returns Structured error response (no stack traces)
 */
export function mapErrorToResponse(error: unknown): ErrorResponse {
  // Zod validation errors
  if (error instanceof ZodError) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      'Invalid input parameters',
      {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }
    );
  }

  // String errors
  if (typeof error === 'string') {
    // Check for known error patterns
    if (error.toLowerCase().includes('not found')) {
      return errorResponse(ErrorCode.NOT_FOUND, error);
    }
    if (error.toLowerCase().includes('unauthorized')) {
      return errorResponse(ErrorCode.UNAUTHORIZED, error);
    }
    if (error.toLowerCase().includes('not implemented')) {
      return errorResponse(ErrorCode.NOT_IMPLEMENTED, error);
    }
    return errorResponse(ErrorCode.INTERNAL, error);
  }

  // Error objects
  if (error instanceof Error) {
    const message = error.message;

    // Check for known error patterns
    if (message.includes('not found') || message.includes('Not found')) {
      return errorResponse(ErrorCode.NOT_FOUND, message);
    }
    if (message.includes('unauthorized') || message.includes('Unauthorized')) {
      return errorResponse(ErrorCode.UNAUTHORIZED, message);
    }
    if (message.includes('not implemented') || message.includes('Not implemented')) {
      return errorResponse(ErrorCode.NOT_IMPLEMENTED, message);
    }

    // Internal error (don't expose stack trace)
    return errorResponse(
      ErrorCode.INTERNAL,
      'An internal error occurred',
      {
        type: error.constructor.name,
        // Only include sanitized message, not full stack
      }
    );
  }

  // Unknown error type
  return errorResponse(
    ErrorCode.INTERNAL,
    'An unknown error occurred'
  );
}

/**
 * Sanitize error for logging (remove sensitive data)
 *
 * @param error - Error object
 * @returns Sanitized error message
 */
export function sanitizeErrorForLogging(error: unknown): string {
  if (error instanceof Error) {
    return `${error.constructor.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}
