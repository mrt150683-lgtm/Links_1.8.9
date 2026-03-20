/**
 * Phase 12: Expanded Health Check
 *
 * Health endpoint with database, worker, and model registry status.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  isDatabaseHealthy,
  getMigrationVersion,
  getModelRegistryStats,
} from '@links/storage';
import { HealthResponseSchema } from '@links/core';

const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request) => {
    request.log.info({ request_id: request.id }, 'Health check requested');

    // Check database connectivity
    const dbHealthy = await isDatabaseHealthy();
    const migrationVersion = dbHealthy ? await getMigrationVersion() : 0;

    // Check model registry status
    const modelRegistry = await getModelRegistryStats();
    const age_hours =
      modelRegistry.age_ms !== null
        ? modelRegistry.age_ms / (1000 * 60 * 60)
        : null;

    // Worker status: optional, defaults to undefined
    // In future, worker could report heartbeat via shared DB or file
    const worker = undefined;

    const response = {
      ok: dbHealthy,
      service: 'api',
      version: '0.1.0',
      time: Date.now(),
      database: {
        connected: dbHealthy,
        migration_version: migrationVersion,
      },
      worker,
      model_registry: {
        fetched_at: modelRegistry.fetched_at,
        age_hours,
      },
    };

    // Validate response structure
    const validated = HealthResponseSchema.parse(response);

    request.log.info(
      {
        request_id: request.id,
        ok: dbHealthy,
        migration_version: migrationVersion,
      },
      'Health check completed'
    );

    return validated;
  });
};

export default healthRoute;
