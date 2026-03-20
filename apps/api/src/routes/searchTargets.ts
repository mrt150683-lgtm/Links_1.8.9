/**
 * Search Targets API Route (030_dyk)
 *
 * GET /search-targets   — returns static registry of search engines
 */

import type { FastifyPluginAsync } from 'fastify';
import { SEARCH_TARGETS } from '../utils/searchTargets.js';

export const searchTargetsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/search-targets', async (_request, reply) => {
    return reply.send({ targets: SEARCH_TARGETS });
  });
};
