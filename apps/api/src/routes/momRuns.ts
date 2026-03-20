/**
 * MoM Runs API Routes
 *
 * Read-only endpoints for inspecting MoM chat run state and event traces.
 * Used by the UI's MomTraceDrawer to show planner decision, agent outputs,
 * and the event log for completed runs.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getChatRun, listChatRunAgents, listChatRunEvents, listChatRunReviews, cancelChatRun } from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'mom-runs-routes' });

const RunIdParamSchema = z.object({ id: z.string() });

export const momRunsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /api/mom/runs/:id ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/mom/runs/:id', async (request, reply) => {
    const { id } = RunIdParamSchema.parse(request.params);

    const [run, agents, reviews] = await Promise.all([
      getChatRun(id),
      listChatRunAgents(id),
      listChatRunReviews(id),
    ]);

    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Chat run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ run, agents, reviews });
  });

  // ── GET /api/mom/runs/:id/events ─────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/mom/runs/:id/events', async (request, reply) => {
    const { id } = RunIdParamSchema.parse(request.params);

    const run = await getChatRun(id);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Chat run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const events = await listChatRunEvents(id);
    return reply.status(200).send({ events });
  });

  // ── GET /api/mom/runs/:id/status ─────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/mom/runs/:id/status', async (request, reply) => {
    const { id } = RunIdParamSchema.parse(request.params);

    const [run, agents] = await Promise.all([
      getChatRun(id),
      listChatRunAgents(id),
    ]);

    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Chat run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const doneCount = agents.filter((a) => a.status === 'done').length;
    const failedCount = agents.filter((a) => a.status === 'failed').length;

    // Map run status to a UI-friendly stage label
    const stageMap: Record<string, string> = {
      pending: 'Initializing',
      planning: 'Planning',
      running: 'Parallel analysis',
      merging: 'Merging',
      done: 'Complete',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };

    return reply.status(200).send({
      run_id: run.id,
      status: run.status,
      stage: stageMap[run.status] ?? run.status,
      execution_mode: run.execution_mode,
      agent_count: agents.length,
      done_count: doneCount,
      failed_count: failedCount,
      error_message: run.error_message ?? null,
      finished_at: run.finished_at ?? null,
    });
  });

  // ── POST /api/mom/runs/:id/cancel ────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/mom/runs/:id/cancel', async (request, reply) => {
    const { id } = RunIdParamSchema.parse(request.params);

    const run = await getChatRun(id);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Chat run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    if (run.status === 'done' || run.status === 'failed') {
      return reply.status(409).send({
        error: 'ConflictError',
        message: `Cannot cancel a run with status '${run.status}'`,
        statusCode: 409,
        request_id: request.id,
      });
    }

    await cancelChatRun(id);
    logger.info({ run_id: id }, 'MoM run cancelled');
    return reply.status(200).send({ run_id: id, status: 'cancelled' });
  });

  logger.info('MoM runs routes registered');
};
