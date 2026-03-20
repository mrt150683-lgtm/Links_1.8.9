/**
 * Deep Research Agent API Routes
 *
 * POST /research/runs              - Create a new research run
 * GET  /research/runs              - List runs for a pot
 * GET  /research/runs/:runId       - Get run details
 * POST /research/runs/:runId/plan/approve - Approve research plan
 * POST /research/runs/:runId/cancel       - Cancel a run
 * POST /research/runs/:runId/resume       - Resume a paused run
 * GET  /research/runs/:runId/report       - Get research report artifact
 * GET  /research/runs/:runId/delta        - Get delta artifact
 * GET  /research/runs/:runId/novelty      - Get novelty artifact
 * GET  /research/runs/:runId/progress     - Get run progress + budget usage
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createResearchRun,
  listResearchRuns,
  getResearchRun,
  approveResearchRunPlan,
  cancelResearchRun,
  getResearchArtifact,
  enqueueJob,
  logAuditEvent,
} from '@links/storage';
import type { ResearchRunStatus } from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';

const CreateRunBodySchema = z.object({
  pot_id: z.string().uuid(),
  goal_prompt: z.string().min(10).max(5000),
  config: ResearchRunConfigSchema.optional(),
  auto_approve_plan: z.boolean().default(false),
  selected_model: z.string().optional(),
  model_overrides: z.record(z.string()).optional(),
  previous_run_id: z.string().uuid().optional(),
});

const RunListQuerySchema = z.object({
  pot_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  status: z.enum(['draft','planning','awaiting_approval','queued','running','paused','done','failed','cancelled']).optional(),
});

const RunIdParamSchema = z.object({
  runId: z.string().uuid(),
});

export const researchRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /research/runs - Create a new research run
  fastify.post('/research/runs', async (request, reply) => {
    const input = CreateRunBodySchema.parse(request.body);

    const run = await createResearchRun({
      pot_id: input.pot_id,
      goal_prompt: input.goal_prompt,
      config: input.config as Record<string, unknown> | undefined,
      selected_model: input.selected_model,
      model_overrides: input.model_overrides as Record<string, string> | undefined,
      previous_run_id: input.previous_run_id,
    });

    // If auto_approve_plan, set in config
    if (input.auto_approve_plan) {
      await enqueueJob({
        job_type: 'deep_research_plan',
        pot_id: run.pot_id,
        priority: 80,
        payload: { run_id: run.id, auto_approve_plan: true },
      });
    } else {
      await enqueueJob({
        job_type: 'deep_research_plan',
        pot_id: run.pot_id,
        priority: 80,
        payload: { run_id: run.id },
      });
    }

    await logAuditEvent({
      actor: 'user',
      action: 'research_run_created',
      pot_id: run.pot_id,
      metadata: { run_id: run.id },
    });

    return reply.status(201).send({ run });
  });

  // GET /research/runs - List runs for a pot
  fastify.get('/research/runs', async (request, reply) => {
    const query = RunListQuerySchema.parse(request.query);
    const result = await listResearchRuns(query.pot_id, {
      limit: query.limit,
      status: query.status as ResearchRunStatus | undefined,
    });
    return reply.status(200).send({ runs: result.runs, total: result.total });
  });

  // GET /research/runs/:runId - Get run details
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);
    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }
    return reply.status(200).send({ run });
  });

  // POST /research/runs/:runId/plan/approve - Approve a plan (transitions to queued)
  fastify.post<{ Params: { runId: string } }>('/research/runs/:runId/plan/approve', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }
    if (run.status !== 'awaiting_approval') {
      return reply.status(409).send({
        error: 'InvalidStateError',
        message: `Run is not awaiting approval (status: ${run.status})`,
        statusCode: 409,
        request_id: request.id,
      });
    }

    await approveResearchRunPlan(runId);

    await enqueueJob({
      job_type: 'deep_research_execute',
      pot_id: run.pot_id,
      priority: 70,
      payload: { run_id: runId, resume: false },
    });

    await logAuditEvent({
      actor: 'user',
      action: 'research_plan_approved',
      pot_id: run.pot_id,
      metadata: { run_id: runId },
    });

    return reply.status(200).send({ ok: true });
  });

  // POST /research/runs/:runId/cancel - Cancel a run
  fastify.post<{ Params: { runId: string } }>('/research/runs/:runId/cancel', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const cancellableStatuses: ResearchRunStatus[] = ['draft', 'planning', 'awaiting_approval', 'queued', 'running', 'paused'];
    if (!cancellableStatuses.includes(run.status)) {
      return reply.status(409).send({
        error: 'InvalidStateError',
        message: `Run cannot be cancelled in status: ${run.status}`,
        statusCode: 409,
        request_id: request.id,
      });
    }

    await cancelResearchRun(runId);

    await logAuditEvent({
      actor: 'user',
      action: 'research_run_cancelled',
      pot_id: run.pot_id,
      metadata: { run_id: runId },
    });

    return reply.status(200).send({ ok: true });
  });

  // POST /research/runs/:runId/resume - Resume a paused run
  fastify.post<{ Params: { runId: string } }>('/research/runs/:runId/resume', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }
    if (run.status !== 'paused') {
      return reply.status(409).send({
        error: 'InvalidStateError',
        message: `Run is not paused (status: ${run.status})`,
        statusCode: 409,
        request_id: request.id,
      });
    }

    await enqueueJob({
      job_type: 'deep_research_execute',
      pot_id: run.pot_id,
      priority: 70,
      payload: { run_id: runId, resume: true },
    });

    await logAuditEvent({
      actor: 'user',
      action: 'research_run_resumed',
      pot_id: run.pot_id,
      metadata: { run_id: runId },
    });

    return reply.status(202).send({ ok: true });
  });

  // GET /research/runs/:runId/plan - Get research plan artifact
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId/plan', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const artifact = await getResearchArtifact(runId, 'research_plan');
    if (!artifact) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Plan artifact not yet available',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ artifact });
  });

  // GET /research/runs/:runId/report - Get research report artifact
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId/report', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const artifact = await getResearchArtifact(runId, 'research_report');
    if (!artifact) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Report artifact not yet available',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ artifact });
  });

  // GET /research/runs/:runId/delta - Get delta artifact
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId/delta', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const artifact = await getResearchArtifact(runId, 'research_delta');
    if (!artifact) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Delta artifact not yet available',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ artifact });
  });

  // GET /research/runs/:runId/novelty - Get novelty artifact
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId/novelty', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const artifact = await getResearchArtifact(runId, 'research_novelty');
    if (!artifact) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Novelty artifact not yet available',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({ artifact });
  });

  // GET /research/runs/:runId/progress - Get run progress + budget usage
  fastify.get<{ Params: { runId: string } }>('/research/runs/:runId/progress', async (request, reply) => {
    const { runId } = RunIdParamSchema.parse(request.params);

    const run = await getResearchRun(runId);
    if (!run) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Research run not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    return reply.status(200).send({
      run_id: runId,
      status: run.status,
      progress: run.progress,
      budget_usage: run.budget_usage,
    });
  });
};
