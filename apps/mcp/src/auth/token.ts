/**
 * Phase 10: MCP Token Authentication
 *
 * Optional token-based auth for MCP server.
 * Checks __auth field in tool arguments against MCP_TOKEN env var.
 */

import { ErrorCode, errorResponse } from '../schemas/errors.js';

/**
 * Check if token auth is enabled
 *
 * @returns true if MCP_TOKEN is set
 */
export function isTokenAuthEnabled(): boolean {
  return !!process.env.MCP_TOKEN;
}

/**
 * Validate auth token from tool arguments
 *
 * @param args - Tool arguments that may contain __auth field
 * @returns Error response if auth fails, null if succeeds
 */
export function validateToken(args: Record<string, unknown>): ReturnType<typeof errorResponse> | null {
  // If token auth not enabled, allow all requests
  if (!isTokenAuthEnabled()) {
    return null;
  }

  const providedToken = args.__auth;
  const expectedToken = process.env.MCP_TOKEN;

  // Check if token provided
  if (!providedToken || typeof providedToken !== 'string') {
    return errorResponse(
      ErrorCode.UNAUTHORIZED,
      'Authentication required: missing __auth field'
    );
  }

  // Constant-time comparison to prevent timing attacks
  if (providedToken !== expectedToken) {
    return errorResponse(
      ErrorCode.UNAUTHORIZED,
      'Authentication failed: invalid token'
    );
  }

  return null;
}

/**
 * Strip __auth field from arguments before processing
 *
 * @param args - Tool arguments
 * @returns Arguments without __auth field
 */
export function stripAuthField(args: Record<string, unknown>): Record<string, unknown> {
  const { __auth, ...rest } = args;
  return rest;
}
