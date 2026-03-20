/**
 * Phase 12: Diagnostics Route
 *
 * Detailed system diagnostics endpoint.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  getDatabasePath,
  getDatabasePragmas,
  getJobQueueStats,
  getAssetStoreStats,
  getModelRegistryStats,
  getMigrationVersion,
} from '@links/storage';
import { DiagnosticsResponseSchema } from '@links/core';

const diagnosticsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/diagnostics', async (request) => {
    request.log.info({ request_id: request.id }, 'Diagnostics requested');

    // Gather all diagnostic data
    const [pragmas, jobQueue, assetStore, modelRegistry, migrationVersion] =
      await Promise.all([
        getDatabasePragmas(),
        getJobQueueStats(),
        getAssetStoreStats(),
        getModelRegistryStats(),
        getMigrationVersion(),
      ]);

    const response = {
      database: {
        path: getDatabasePath(),
        wal_mode: pragmas.wal_mode,
        synchronous: pragmas.synchronous,
        migration_version: migrationVersion,
      },
      job_queue: jobQueue,
      asset_store: assetStore,
      model_registry: modelRegistry,
    };

    // Validate response structure
    const validated = DiagnosticsResponseSchema.parse(response);

    request.log.info(
      {
        request_id: request.id,
        migration_version: migrationVersion,
        job_queue_total:
          jobQueue.queued + jobQueue.running + jobQueue.failed + jobQueue.dead,
        asset_count: assetStore.blob_count,
      },
      'Diagnostics collected'
    );

    return validated;
  });
};

export default diagnosticsRoute;
