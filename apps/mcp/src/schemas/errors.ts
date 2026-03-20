/**
 * Phase 10: MCP Error Schemas
 *
 * Structured error responses for MCP tools.
 * Never expose raw stack traces to clients.
 */

import { z } from 'zod';

/**
 * Error codes for MCP responses
 */
export enum ErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INTERNAL = 'INTERNAL',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

/**
 * Structured error response
 */
export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.nativeEnum(ErrorCode),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Success response wrapper (generic)
 */
export function successResponse<T>(data: T): { ok: true } & T {
  return { ok: true, ...data } as { ok: true } & T;
}

/**
 * Error response factory
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}
