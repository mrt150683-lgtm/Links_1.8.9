/**
 * Phase 11: Extension Auth Route
 *
 * Token rotation endpoint for extension authentication.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { rotateExtensionToken, getOrInitializeExtensionToken } from '@links/storage';
import { extAuthMiddleware } from '../../middleware/extAuth.js';
import { rateLimitExtMiddleware } from '../../middleware/rateLimitExt.js';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'ext:auth' });

export default async function extAuthRoutes(fastify: FastifyInstance) {
  /**
   * POST /ext/auth/rotate
   *
   * Rotate extension token (generate new token)
   * Requires existing valid token for authentication
   */
  fastify.post(
    '/auth/rotate',
    {
      preHandler: [rateLimitExtMiddleware, extAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const requestId = request.id;

      logger.info(
        { requestId },
        'Extension token rotation requested'
      );

      // Rotate token
      const tokenData = await rotateExtensionToken();

      logger.info(
        { requestId, rotated_at: tokenData.last_rotated_at },
        'Extension token rotated successfully'
      );

      // Return new token (ONLY time it's exposed)
      return {
        ok: true,
        token: tokenData.token,
        created_at: tokenData.created_at,
        last_rotated_at: tokenData.last_rotated_at,
        warning: 'Save this token immediately. It will not be shown again.',
      };
    }
  );

  /**
   * POST /ext/auth/bootstrap
   *
   * Bootstrap endpoint to get initial token
   * Requires EXT_BOOTSTRAP_TOKEN environment variable for security
   * This endpoint is unprotected but requires a one-time bootstrap token
   */
  fastify.post(
    '/auth/bootstrap',
    {
      preHandler: rateLimitExtMiddleware,
    },
    async (request: FastifyRequest) => {
      const requestId = request.id;
      const body = request.body as any;

      // Check bootstrap token from environment
      const bootstrapToken = process.env.EXT_BOOTSTRAP_TOKEN;

      if (!bootstrapToken) {
        logger.warn(
          { requestId },
          'Bootstrap attempt but EXT_BOOTSTRAP_TOKEN not set'
        );
        return {
          ok: false,
          error: 'Bootstrap not available',
          details: 'Set EXT_BOOTSTRAP_TOKEN environment variable to enable bootstrap',
        };
      }

      // Validate provided bootstrap token
      if (body.bootstrap_token !== bootstrapToken) {
        logger.warn(
          { requestId },
          'Bootstrap attempt with invalid token'
        );
        return {
          ok: false,
          error: 'Invalid bootstrap token',
        };
      }

      // Get or initialize extension token
      const tokenData = await getOrInitializeExtensionToken();

      logger.info(
        { requestId },
        'Extension token bootstrapped'
      );

      return {
        ok: true,
        token: tokenData.token,
        created_at: tokenData.created_at,
        last_rotated_at: tokenData.last_rotated_at,
        warning: 'Save this token immediately and use /ext/auth/rotate to change it.',
      };
    }
  );
}
