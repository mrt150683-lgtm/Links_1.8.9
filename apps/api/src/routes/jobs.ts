/**
 * Jobs API routes
 * Phase 5: Processing Engine
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  EnqueueJobRequestSchema,
  ListJobsQuerySchema,
  RunNowRequestSchema,
  type EnqueueJobRequest,
  type ListJobsQuery,
  type RunNowRequest,
} from '@links/core';
import {
  enqueueJob,
  listJobs,
  setForceRunNow,
  requeueJob,
  requeueAllDead,
  listDeadJobs,
  getEntryById,
} from '@links/storage';

export default async function jobsRoute(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /jobs/enqueue
   * Manually enqueue a job
   */
  fastify.post<{
    Body: EnqueueJobRequest;
  }>('/jobs/enqueue', async (request, reply) => {
    // Debug: log raw body
    request.log.debug({ raw_body: request.body }, 'Raw request body before parsing');

    // Validate request body with Zod
    const input = EnqueueJobRequestSchema.parse(request.body);

    // Debug: log parsed input
    request.log.debug({ parsed_input: input }, 'Parsed input after Zod');

      // Enqueue job
      const job = await enqueueJob({
        job_type: input.job_type,
        pot_id: input.pot_id,
        entry_id: input.entry_id,
        priority: input.priority,
        run_after: input.run_after,
        max_attempts: input.max_attempts,
        payload: input.payload,
      });

      request.log.info({
        job_id: job.id,
        job_type: job.job_type,
        pot_id: job.pot_id,
        entry_id: job.entry_id,
        msg: 'Job enqueued',
      });

    return reply.status(201).send({ job });
  });

  /**
   * GET /jobs
   * List jobs with filters
   */
  fastify.get<{
    Querystring: ListJobsQuery;
  }>('/jobs', async (request, reply) => {
    // Validate query with Zod
    const query = ListJobsQuerySchema.parse(request.query);

      // List jobs
      const jobs = await listJobs({
        status: query.status,
        job_type: query.job_type,
        pot_id: query.pot_id,
        entry_id: query.entry_id,
        limit: query.limit,
        offset: query.offset,
      });

      // Enrich jobs with entry source_title for display
      const entryCache = new Map<string, string | null>();
      const enrichedJobs = await Promise.all(
        jobs.map(async (job) => {
          let entry_title: string | null = null;
          if (job.entry_id) {
            if (entryCache.has(job.entry_id)) {
              entry_title = entryCache.get(job.entry_id)!;
            } else {
              const entry = await getEntryById(job.entry_id);
              entry_title = entry?.source_title ?? null;
              entryCache.set(job.entry_id, entry_title);
            }
          }
          return { ...job, entry_title };
        })
      );

      const total = enrichedJobs.length;

    return reply.status(200).send({
      jobs: enrichedJobs,
      total,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
  });

  /**
   * GET /jobs/:id
   * Get job by ID
   */
  fastify.get<{
    Params: { id: string };
  }>('/jobs/:id', async (request, reply) => {
    const { id } = request.params;

    // Import getJob here to avoid circular dependency
    const { getJob } = await import('@links/storage');
    const job = await getJob(id);

    if (!job) {
      return reply.status(404).send({
        error: 'NotFound',
        message: `Job not found: ${id}`,
      });
    }

    return reply.status(200).send({ job });
  });

  /**
   * POST /jobs/run-now
   * Force processing for N minutes (override idle policy)
   */
  fastify.post<{
    Body: RunNowRequest;
  }>('/jobs/run-now', async (request, reply) => {
    // Validate request body with Zod
    const { minutes } = RunNowRequestSchema.parse(request.body);

      // Set force run override
      const forceRunUntil = await setForceRunNow(minutes);

      request.log.info({
        minutes,
        force_run_until: forceRunUntil,
        msg: 'Force run override activated',
      });

    return reply.status(200).send({
      force_run_until: forceRunUntil,
      minutes,
    });
  });

  /**
   * Phase 12: POST /jobs/:id/requeue
   * Requeue a failed or dead job for retry
   */
  fastify.post<{
    Params: { id: string };
  }>('/jobs/:id/requeue', async (request, reply) => {
    const { id } = request.params;

    try {
      const job = await requeueJob(id);

      request.log.info({
        job_id: job.id,
        job_type: job.job_type,
        msg: 'Job requeued',
      });

      return reply.status(200).send({ job });
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('not found')) {
        return reply.status(404).send({
          error: 'NotFound',
          message: err.message,
        });
      }
      if (err.message.includes('must be failed or dead')) {
        return reply.status(400).send({
          error: 'InvalidStatus',
          message: err.message,
        });
      }
      throw error;
    }
  });

  /**
   * Phase 12: POST /jobs/requeue-dead
   * Requeue all dead jobs
   */
  fastify.post('/jobs/requeue-dead', async (request, reply) => {
    const count = await requeueAllDead();

    request.log.info({
      count,
      msg: 'Dead jobs requeued',
    });

    return reply.status(200).send({
      count,
      message: `${count} dead job(s) requeued`,
    });
  });

  /**
   * Phase 12: GET /jobs/dead
   * List all dead jobs
   */
  fastify.get('/jobs/dead', async (request, reply) => {
    const jobs = await listDeadJobs();

    return reply.status(200).send({
      jobs,
      total: jobs.length,
    });
  });
}
