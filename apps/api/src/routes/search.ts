/**
 * Phase 12: Search Routes
 *
 * Full-text search within a pot.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { searchEntries } from '@links/storage';
import { SearchQuerySchema, type SearchQuery } from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'search' });

export default async function searchRoute(fastify: FastifyInstance) {
  /**
   * GET /pots/:potId/search
   *
   * Search entries in a pot by full-text query.
   *
   * Query parameters:
   * - q (required): search query
   * - limit (optional): max results (default 20, max 100)
   * - offset (optional): pagination offset (default 0)
   * - type (optional): filter by entry type (text|image|doc|link)
   * - min_confidence (optional): minimum confidence for artifact matches
   * - has_assets (optional): filter by asset presence
   */
  fastify.get<{ Params: { potId: string }; Querystring: Record<string, unknown> }>(
    '/pots/:potId/search',
    async (request: FastifyRequest<{ Params: { potId: string }; Querystring: Record<string, unknown> }>) => {
      const requestId = request.id;
      const potId = request.params.potId;

      // Validate query parameters
      let query: SearchQuery;
      try {
        query = SearchQuerySchema.parse(request.query);
      } catch (error) {
        return {
          ok: false,
          error: 'Invalid search query',
          details: (error as any).message,
        };
      }

      const { q, limit, offset, type, min_confidence, has_assets } = query;

      logger.info(
        {
          requestId,
          pot_id: potId,
          q: q.substring(0, 50),
          limit,
          offset,
          type,
          has_assets,
        },
        'Search requested'
      );

      // Execute search
      const { results, intelligence_results, total } = await searchEntries({
        potId,
        query: q,
        limit,
        offset,
        type,
        minConfidence: min_confidence,
        hasAssets: has_assets,
      });

      logger.info(
        {
          requestId,
          pot_id: potId,
          total,
          returned: results.length,
        },
        'Search completed'
      );

      return {
        q,
        pot_id: potId,
        results,
        intelligence_results,
        total,
        limit,
        offset,
      };
    }
  );
}
