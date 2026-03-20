/**
 * Phase 11: Extension Authentication Middleware
 *
 * Validates extension token on /ext/* routes.
 * Accepts token via:
 * - Authorization: Bearer <token>
 * - X-Ext-Token: <token>
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateExtensionToken } from '@links/storage';

/**
 * Extract token from request headers
 *
 * @param request - Fastify request
 * @returns Token string or null
 */
function extractToken(request: FastifyRequest): string | null {
  // Try Authorization: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Try X-Ext-Token: <token>
  const extTokenHeader = request.headers['x-ext-token'];
  if (typeof extTokenHeader === 'string') {
    return extTokenHeader;
  }

  return null;
}

/**
 * Extension auth middleware
 *
 * Validates token and returns 401 if invalid/missing
 */
export async function extAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({
      ok: false,
      error: 'Unauthorized: Extension token required',
      details: 'Provide token via Authorization: Bearer <token> or X-Ext-Token: <token>',
    });
  }

  // Accept EXT_BOOTSTRAP_TOKEN from env directly (set by launcher on install)
  const envToken = process.env.EXT_BOOTSTRAP_TOKEN;
  if (envToken && token === envToken) {
    return; // Valid — continue to route handler
  }

  const isValid = await validateExtensionToken(token);

  if (!isValid) {
    return reply.status(401).send({
      ok: false,
      error: 'Unauthorized: Invalid extension token',
    });
  }

  // Token valid, continue to route handler
}
