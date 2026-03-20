/**
 * Self-Evolving Research Agent Routes
 *
 * Endpoints:
 *   GET  /pots/:potId/agent-config
 *   PUT  /pots/:potId/agent-config
 *   POST /pots/:potId/agent-runs
 *   GET  /pots/:potId/agent-runs
 *   GET  /agent-runs/:runId
 *   POST /agent-runs/:runId/cancel
 *   POST /agent-runs/:runId/resume
 *   GET  /pots/:potId/agent-candidates
 *   POST /agent-candidates/:id/feedback
 *   POST /agent-candidates/:id/undo
 *   POST /agent-candidates/:id/open-chat
 *   POST /agent-candidates/:id/open-search
 *   GET  /pots/:potId/agent-tools
 *   GET  /agent-tools/:toolId
 *   POST /agent-tools/:toolId/approve
 *   POST /agent-tools/:toolId/reject
 *   POST /agent-tools/:toolId/disable
 *   POST /agent-tools/:toolId/enable
 *   POST /agent-tools/:toolId/run
 *   GET  /agent-tools/:toolId/versions
 *   GET  /agent-tool-runs/:runId
 *   GET  /agent/registry
 *   GET  /agent/diagnostics
 *
 * Migrations: 040-043
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAgentConfig,
  upsertAgentConfig,
  createAgentRun,
  getAgentRun,
  updateAgentRunStatus,
  listAgentRuns,
  getAgentCandidate,
  listAgentCandidates,
  recordFeedback,
  archiveCandidate,
  markCandidateDelivered,
  snoozeCandidate,
  getAgentTool,
  listAgentTools,
  updateAgentToolStatus,
  listToolVersions,
  rollbackAgentTool,
  createAgentToolRun,
  getAgentToolRun,
  updateAgentToolRunStatus,
  listAgentSnapshotsByPot,
  listAgentArtifactsByPotAndType,
  enqueueJob,
  logAuditEvent,
} from '@links/storage';
import {
  CreateAgentConfigSchema,
  AgentCandidateListQuerySchema,
  AgentFeedbackRequestSchema,
  AgentRunListQuerySchema,
  TriggerAgentRunSchema,
  AgentToolRunRequestSchema,
} from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'agent-routes' });

export const agentRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Config ───────────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/agent-config', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const config = await getAgentConfig(potId);
    if (!config) {
      return reply.status(404).send({ error: 'NotFound', message: 'Agent not configured for this pot' });
    }
    return config;
  });

  fastify.put('/pots/:potId/agent-config', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const body = CreateAgentConfigSchema.parse(req.body);
    const config = await upsertAgentConfig(potId, body);

    await logAuditEvent({
      actor: 'user',
      action: 'agent_config_updated',
      pot_id: potId,
      metadata: { enabled: config.enabled, mode: config.mode },
    });

    logger.info({ pot_id: potId, enabled: config.enabled, msg: 'Agent config updated' });
    return config;
  });

  // ── Runs ─────────────────────────────────────────────────────────────────

  fastify.post('/pots/:potId/agent-runs', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const body = TriggerAgentRunSchema.parse(req.body ?? {});

    const config = await getAgentConfig(potId);
    if (!config?.enabled) {
      return reply.status(400).send({ error: 'AgentDisabled', message: 'Agent is not enabled for this pot' });
    }

    const run = await createAgentRun({ pot_id: potId, run_type: body.run_type ?? 'manual' });

    await enqueueJob({
      job_type: 'agent_heartbeat',
      payload: { run_id: run.id, pot_id: potId },
      priority: 20,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'agent_run_created',
      pot_id: potId,
      metadata: { run_id: run.id, run_type: run.run_type, triggered_by: 'user' },
    });

    return reply.status(201).send(run);
  });

  fastify.get('/pots/:potId/agent-runs', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = AgentRunListQuerySchema.parse(req.query);
    const result = await listAgentRuns(potId, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return result;
  });

  fastify.get('/agent-runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getAgentRun(runId);
    if (!run) return reply.status(404).send({ error: 'NotFound', message: 'Run not found' });
    return run;
  });

  fastify.post('/agent-runs/:runId/cancel', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getAgentRun(runId);
    if (!run) return reply.status(404).send({ error: 'NotFound', message: 'Run not found' });
    await updateAgentRunStatus(runId, 'cancelled', { finished_at: Date.now() });
    return { ok: true };
  });

  fastify.post('/agent-runs/:runId/resume', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getAgentRun(runId);
    if (!run) return reply.status(404).send({ error: 'NotFound', message: 'Run not found' });
    if (run.status !== 'paused') {
      return reply.status(400).send({ error: 'InvalidState', message: 'Run is not paused' });
    }
    await updateAgentRunStatus(runId, 'pending');
    await enqueueJob({
      job_type: 'agent_heartbeat',
      payload: { run_id: runId, pot_id: run.pot_id },
      priority: 20,
    });
    return { ok: true };
  });

  // ── Candidates ────────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/agent-candidates', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = AgentCandidateListQuerySchema.parse(req.query);
    return listAgentCandidates(potId, {
      status: query.status,
      candidate_type: query.candidate_type,
      limit: query.limit,
      offset: query.offset,
    });
  });

  fastify.post('/agent-candidates/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = AgentFeedbackRequestSchema.parse(req.body);

    const candidate = await getAgentCandidate(id);
    if (!candidate) return reply.status(404).send({ error: 'NotFound', message: 'Candidate not found' });

    // Apply status changes based on action
    if (body.action === 'snooze' && body.snooze_hours) {
      const snoozedUntil = Date.now() + body.snooze_hours * 3600000;
      await snoozeCandidate(id, snoozedUntil);
    } else if (body.action === 'useless' || body.action === 'meh') {
      await archiveCandidate(id);
    }

    const event = await recordFeedback(candidate.pot_id, id, body.action, body.metadata);
    return event;
  });

  fastify.post('/agent-candidates/:id/undo', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidate = await getAgentCandidate(id);
    if (!candidate) return reply.status(404).send({ error: 'NotFound', message: 'Candidate not found' });
    // Reset to delivered if it was previously delivered
    if (candidate.status === 'archived' || candidate.status === 'snoozed') {
      await markCandidateDelivered(id);
      await recordFeedback(candidate.pot_id, id, 'undo');
    }
    return { ok: true };
  });

  fastify.post('/agent-candidates/:id/open-chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidate = await getAgentCandidate(id);
    if (!candidate) return reply.status(404).send({ error: 'NotFound', message: 'Candidate not found' });
    await recordFeedback(candidate.pot_id, id, 'opened_chat');
    return {
      ok: true,
      chat_seed: candidate.launch_payload?.chat_seed ?? candidate.body,
      pot_id: candidate.pot_id,
    };
  });

  fastify.post('/agent-candidates/:id/open-search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidate = await getAgentCandidate(id);
    if (!candidate) return reply.status(404).send({ error: 'NotFound', message: 'Candidate not found' });
    await recordFeedback(candidate.pot_id, id, 'opened_search');
    return {
      ok: true,
      search_query: candidate.launch_payload?.search_query ?? candidate.title,
      pot_id: candidate.pot_id,
    };
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/agent-tools', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
    }).parse(req.query);
    return listAgentTools(potId, { status: query.status as any, limit: query.limit, offset: query.offset });
  });

  fastify.get('/agent-tools/:toolId', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    return tool;
  });

  fastify.post('/agent-tools/:toolId/approve', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    if (tool.status !== 'awaiting_approval') {
      return reply.status(400).send({ error: 'InvalidState', message: 'Tool is not awaiting approval' });
    }
    await updateAgentToolStatus(toolId, 'active');
    await logAuditEvent({
      actor: 'user',
      action: 'agent_tool_approved',
      pot_id: tool.pot_id,
      metadata: { tool_id: toolId, tool_key: tool.tool_key },
    });
    // Record feedback if there's a tool_offer candidate
    return { ok: true };
  });

  fastify.post('/agent-tools/:toolId/reject', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    await updateAgentToolStatus(toolId, 'rejected');
    await logAuditEvent({
      actor: 'user',
      action: 'agent_tool_rejected',
      pot_id: tool.pot_id,
      metadata: { tool_id: toolId, tool_key: tool.tool_key },
    });
    return { ok: true };
  });

  fastify.post('/agent-tools/:toolId/disable', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    await updateAgentToolStatus(toolId, 'disabled');
    await logAuditEvent({
      actor: 'user',
      action: 'agent_tool_disabled',
      pot_id: tool.pot_id,
      metadata: { tool_id: toolId },
    });
    return { ok: true };
  });

  fastify.post('/agent-tools/:toolId/enable', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    if (tool.status !== 'disabled') {
      return reply.status(400).send({ error: 'InvalidState', message: 'Tool is not disabled' });
    }
    await updateAgentToolStatus(toolId, 'active');
    return { ok: true };
  });

  fastify.post('/agent-tools/:toolId/run', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const body = AgentToolRunRequestSchema.parse(req.body ?? {});

    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });
    if (tool.status !== 'active') {
      return reply.status(400).send({ error: 'InvalidState', message: 'Tool is not active' });
    }

    const config = await getAgentConfig(tool.pot_id);
    if (!config?.enabled) {
      return reply.status(400).send({ error: 'AgentDisabled', message: 'Agent is disabled for this pot' });
    }

    await enqueueJob({
      job_type: 'agent_tool_run',
      payload: {
        pot_id: tool.pot_id,
        tool_id: toolId,
        trigger_type: body.trigger_type,
        input_payload: body.input_payload,
      },
      priority: 25,
    });

    return reply.status(201).send({ ok: true, tool_id: toolId });
  });

  fastify.get('/agent-tools/:toolId/versions', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const versions = await listToolVersions(toolId);
    return { versions };
  });

  fastify.get('/agent-tool-runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getAgentToolRun(runId);
    if (!run) return reply.status(404).send({ error: 'NotFound', message: 'Tool run not found' });
    return run;
  });

  // ── Tool Rollback ─────────────────────────────────────────────────────────

  fastify.post('/agent-tools/:toolId/rollback', async (req, reply) => {
    const { toolId } = req.params as { toolId: string };
    const body = z.object({ version_id: z.string() }).parse(req.body);

    const tool = await getAgentTool(toolId);
    if (!tool) return reply.status(404).send({ error: 'NotFound', message: 'Tool not found' });

    try {
      const version = await rollbackAgentTool(toolId, body.version_id);
      await logAuditEvent({
        actor: 'user',
        action: 'agent_tool_rolled_back',
        pot_id: tool.pot_id,
        metadata: { tool_id: toolId, version_id: body.version_id, rolled_back_to_version: version.version },
      });
      logger.info({ tool_id: toolId, version_id: body.version_id, msg: 'Tool rolled back' });
      return { ok: true, rolled_back_to: version.version };
    } catch (err) {
      return reply.status(400).send({
        error: 'RollbackFailed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Snapshots ─────────────────────────────────────────────────────────────

  fastify.get('/agent/pots/:potId/snapshots', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = z.object({
      limit: z.coerce.number().optional(),
    }).parse(req.query);

    const [snapshots, reports] = await Promise.all([
      listAgentSnapshotsByPot(potId, query.limit ?? 20),
      listAgentArtifactsByPotAndType(potId, 'snapshot_report' as any, query.limit ?? 20),
    ]);

    // Merge reports into snapshots by snapshot_id
    const reportMap = new Map<string, any>();
    for (const r of reports) {
      const snapshotId = (r.payload as any)?.snapshot_id;
      if (snapshotId) reportMap.set(snapshotId, r);
    }

    const enriched = snapshots.map((s) => ({
      ...s,
      report: reportMap.get(s.id) ?? null,
    }));

    return { snapshots: enriched };
  });

  // ── Registry + Diagnostics ────────────────────────────────────────────────

  fastify.get('/agent/registry', async (_req, _reply) => {
    const builtInCapabilities = [
      { id: 'entries.search', label: 'Search Entries', kind: 'read', sandbox_callable: true },
      { id: 'entries.read', label: 'Read Entry', kind: 'read', sandbox_callable: true },
      { id: 'artifacts.search', label: 'Search Artifacts', kind: 'read', sandbox_callable: true },
      { id: 'artifacts.createDerived', label: 'Create Derived Artifact', kind: 'write', sandbox_callable: true },
      { id: 'notify.emitCandidate', label: 'Emit Candidate', kind: 'write', sandbox_callable: true },
      { id: 'links.search', label: 'Search Links', kind: 'read', sandbox_callable: true },
      { id: 'entities.search', label: 'Search Entities', kind: 'read', sandbox_callable: true },
    ];
    return { capabilities: builtInCapabilities };
  });

  fastify.get('/agent/diagnostics', async (_req, _reply) => {
    return {
      scheduler_active: true,
      version: 'v1',
      features: ['heartbeat', 'tool_build', 'tool_test', 'tool_run', 'cross_pot_bridge'],
    };
  });
};
