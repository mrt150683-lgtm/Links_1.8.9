import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createRun,
  listRunsByPot,
  getRun,
  saveAnswers,
  listFiles,
  getFile,
  approveRun,
  rejectRun,
  enqueueJob,
  updateRunStatus,
} from '@links/storage';
import { ProjectAnswersSchema } from '@links/core';

const CreateRunSchema = z.object({
  pot_id: z.string().uuid(),
  project_name: z.string().min(1).max(200),
  project_type: z.string().min(1).max(100),
  model_profile: z.record(z.unknown()).optional(),
});

const RunListQuerySchema = z.object({
  pot_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const AnswerBodySchema = ProjectAnswersSchema;
const RejectSchema = z.object({ feedback: z.string().min(3).max(4000) });
const RevisionSchema = z.object({ revision: z.coerce.number().int().positive().optional() });
const DocGenerateSchema = z.object({ doc_paths: z.array(z.string().min(1).max(255)).min(1).max(30).optional() });

export const planningRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/planning/runs', async (request, reply) => {
    const input = CreateRunSchema.parse(request.body);
    const run = await createRun(input);
    return reply.status(201).send({ run });
  });

  fastify.get('/planning/runs', async (request, reply) => {
    const query = RunListQuerySchema.parse(request.query);
    const runs = await listRunsByPot(query.pot_id, query.limit);
    return reply.status(200).send({ runs });
  });

  fastify.get<{ Params: { runId: string } }>('/planning/runs/:runId', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    }
    return reply.status(200).send({ run });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/questions/generate', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });

    const job = await enqueueJob({
      job_type: 'planning_generate_questions',
      pot_id: run.pot_id,
      priority: 100,
      payload: { runId: run.id, revision: run.revision },
    });
    return reply.status(202).send({ job_id: job.id });
  });

  fastify.get<{ Params: { runId: string } }>('/planning/runs/:runId/questions', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const file = await getFile(run.id, run.revision, 'questions.json');
    return reply.status(200).send({ questions: file?.content_text ? JSON.parse(file.content_text) : null });
  });

  fastify.put<{ Params: { runId: string } }>('/planning/runs/:runId/questions/answers', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const answers = AnswerBodySchema.parse(request.body);
    const saved = await saveAnswers(run.id, run.revision, answers);
    await enqueueJob({
      job_type: 'planning_generate_plan',
      pot_id: run.pot_id,
      priority: 100,
      payload: { runId: run.id, revision: run.revision },
    });
    return reply.status(200).send({ answers: saved });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/plan/generate', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const job = await enqueueJob({
      job_type: 'planning_generate_plan',
      pot_id: run.pot_id,
      priority: 100,
      payload: { runId: run.id, revision: run.revision },
    });
    return reply.status(202).send({ job_id: job.id });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/plan/approve', async (request, reply) => {
    await approveRun(request.params.runId);
    return reply.status(200).send({ ok: true });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/plan/reject', async (request, reply) => {
    const { feedback } = RejectSchema.parse(request.body);
    await rejectRun(request.params.runId, feedback);
    return reply.status(200).send({ ok: true });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/phases/generate', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const indexFile = await getFile(run.id, run.revision, 'plan.index.json');
    if (!indexFile?.content_text) return reply.status(409).send({ error: 'InvalidStateError', message: 'plan.index.json missing', statusCode: 409, request_id: request.id });
    const index = JSON.parse(indexFile.content_text) as { phases?: Array<{ phase_number: number }> };
    const phaseNumbers = (index.phases ?? []).map((p) => p.phase_number);
    const jobs = [] as string[];
    for (const phaseNumber of phaseNumbers) {
      const j = await enqueueJob({
        job_type: 'planning_generate_phase',
        pot_id: run.pot_id,
        priority: 90,
        payload: { runId: run.id, revision: run.revision, phaseNumber },
      });
      jobs.push(j.id);
    }
    await updateRunStatus(run.id, 'phases_generated');
    return reply.status(202).send({ job_ids: jobs });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/docs/generate', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const body = DocGenerateSchema.parse(request.body ?? {});
    let resolvedDocPaths = body.doc_paths ?? [];
    if (resolvedDocPaths.length === 0) {
      const indexFile = await getFile(run.id, run.revision, 'plan.index.json');
      const index = indexFile?.content_text ? JSON.parse(indexFile.content_text) : { recommended_docs: [] };
      resolvedDocPaths = (index.recommended_docs ?? []).map((p: string) => p.startsWith('docs/') ? p : `docs/${p}`);
    }

    const jobs: string[] = [];
    for (const docPath of resolvedDocPaths) {
      const j = await enqueueJob({
        job_type: 'planning_generate_doc',
        pot_id: run.pot_id,
        priority: 80,
        payload: { runId: run.id, revision: run.revision, docPath },
      });
      jobs.push(j.id);
    }
    await updateRunStatus(run.id, 'docs_generated');
    return reply.status(202).send({ job_ids: jobs });
  });

  fastify.get<{ Params: { runId: string }, Querystring: { revision?: string } }>('/planning/runs/:runId/files', async (request, reply) => {
    const rev = RevisionSchema.parse(request.query).revision;
    const files = await listFiles(request.params.runId, rev);
    return reply.status(200).send({ files });
  });


  fastify.get<{ Params: { runId: string; path: string }, Querystring: { revision?: string } }>('/planning/runs/:runId/files/:path', async (request, reply) => {
    const rev = RevisionSchema.parse(request.query).revision;
    if (!rev) return reply.status(400).send({ error: 'ValidationError', message: 'revision query required', statusCode: 400, request_id: request.id });
    const file = await getFile(request.params.runId, rev, request.params.path);
    if (!file) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning file not found', statusCode: 404, request_id: request.id });
    return reply.status(200).send({ file });
  });

  fastify.get<{ Params: { runId: string; path: string }, Querystring: { revision?: string } }>('/planning/runs/:runId/files/*', async (request, reply) => {
    const rev = RevisionSchema.parse(request.query).revision;
    const path = (request.params as any)['*'] as string;
    if (!rev) return reply.status(400).send({ error: 'ValidationError', message: 'revision query required', statusCode: 400, request_id: request.id });
    const file = await getFile(request.params.runId, rev, path);
    if (!file) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning file not found', statusCode: 404, request_id: request.id });
    return reply.status(200).send({ file });
  });

  fastify.post<{ Params: { runId: string } }>('/planning/runs/:runId/export', async (request, reply) => {
    const run = await getRun(request.params.runId);
    if (!run) return reply.status(404).send({ error: 'NotFoundError', message: 'Planning run not found', statusCode: 404, request_id: request.id });
    const job = await enqueueJob({
      job_type: 'planning_export_zip',
      pot_id: run.pot_id,
      priority: 100,
      payload: { runId: run.id, revision: run.revision },
    });
    return reply.status(202).send({ job_id: job.id });
  });
};
