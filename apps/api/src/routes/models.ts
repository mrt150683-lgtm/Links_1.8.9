/**
 * Phase 6: AI Models Routes
 *
 * Endpoints for model registry management
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getAllModels, getVisionModels, getLastFetchTime, enqueueJob } from '@links/storage';

/**
 * Schema for refresh request
 */
const RefreshRequestSchema = z.object({
  trigger: z.enum(['manual', 'scheduled']).default('manual'),
});

/**
 * Models routes plugin
 */
export const modelsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /models
   * List all cached models
   */
  fastify.get('/models', async (request, reply) => {
    const models = await getAllModels();
    const lastFetch = await getLastFetchTime();

    return reply.status(200).send({
      models,
      cache: {
        last_fetch: lastFetch,
        count: models.length,
      },
    });
  });

  /**
   * GET /models/vision
   * List only vision-capable models
   */
  fastify.get('/models/vision', async (request, reply) => {
    const models = await getVisionModels();

    return reply.status(200).send({
      models,
      count: models.length,
    });
  });

  /**
   * POST /models/refresh
   * Enqueue a job to refresh model cache from OpenRouter
   */
  fastify.post('/models/refresh', async (request, reply) => {
    // Validate request body
    const validation = RefreshRequestSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: validation.error.format(),
      });
    }

    const { trigger } = validation.data;

    // Enqueue refresh job
    const job = await enqueueJob({
      job_type: 'refresh_models',
      priority: trigger === 'manual' ? 100 : 50, // Manual refresh gets higher priority
    });

    return reply.status(201).send({
      job: {
        id: job.id,
        status: job.status,
        created_at: job.created_at,
      },
      message: 'Model refresh job enqueued',
    });
  });
};
