/**
 * Automation & Heartbeat Routes
 *
 * Endpoints:
 *   GET  /prefs/automation
 *   PUT  /prefs/automation
 *   GET  /pots/:potId/automation
 *   PUT  /pots/:potId/automation
 *   GET  /pots/:potId/heartbeat/latest
 *   GET  /pots/:potId/heartbeat/history
 *   POST /pots/:potId/heartbeat/run
 *   POST /pots/:potId/heartbeat/render
 *   GET  /pots/:potId/tasks
 *   POST /pots/:potId/tasks
 *   PATCH /tasks/:taskId
 *   POST /tasks/:taskId/complete
 *   POST /tasks/:taskId/pause
 *   POST /tasks/:taskId/resume
 *   POST /tasks/:taskId/run-now
 *   GET  /pots/:potId/automation/queue
 *   GET  /pots/:potId/automation/runs
 *   GET  /automation/diagnostics
 *
 * Migrations: 044-046
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAutomationSettings,
  upsertAutomationSettings,
  getLatestHeartbeatSnapshot,
  listHeartbeatSnapshots,
  getLatestHeartbeatDocument,
  listScheduledTasks,
  createScheduledTask,
  getScheduledTask,
  updateScheduledTask,
  listRecentTaskRuns,
  enqueueJob,
  logAuditEvent,
  getPreference,
  setPreference,
  computeTaskNextRunAt,
  getSystemTimezone,
} from '@links/storage';
import {
  UpsertAutomationSettingsSchema,
  AutomationPrefsSchema,
  ScheduledTaskCreateSchema,
  ScheduledTaskUpdateSchema,
} from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'automation-routes' });

const AUTOMATION_PREFS_KEY = 'automation.prefs';

export const automationRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Global prefs ─────────────────────────────────────────────────────────

  fastify.get('/prefs/automation', async (_req, reply) => {
    const prefs = await getPreference<Record<string, unknown>>(AUTOMATION_PREFS_KEY) ?? {};
    return reply.send({ prefs });
  });

  fastify.put('/prefs/automation', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const parsed = AutomationPrefsSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.errors });
    }
    await setPreference(AUTOMATION_PREFS_KEY, parsed.data);
    return reply.send({ ok: true, prefs: parsed.data });
  });

  // ── Per-pot automation settings ───────────────────────────────────────────

  fastify.get('/pots/:potId/automation', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    let settings = await getAutomationSettings(potId);
    if (!settings) {
      // Create defaults on first access
      settings = await upsertAutomationSettings(potId, {});
    }
    return reply.send({ settings });
  });

  fastify.put('/pots/:potId/automation', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const body = req.body as Record<string, unknown>;
    const parsed = UpsertAutomationSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.errors });
    }
    const settings = await upsertAutomationSettings(potId, parsed.data);
    await logAuditEvent({
      actor: 'user',
      action: 'automation_settings_updated',
      pot_id: potId,
      metadata: { patch: parsed.data },
    });
    return reply.send({ settings });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/heartbeat/latest', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const [snapshot, document] = await Promise.all([
      getLatestHeartbeatSnapshot(potId),
      getLatestHeartbeatDocument(potId),
    ]);
    if (!snapshot) {
      return reply.send({ snapshot: null, document: null });
    }
    return reply.send({ snapshot, document });
  });

  fastify.get('/pots/:potId/heartbeat/history', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const snapshots = await listHeartbeatSnapshots(potId, limit);
    return reply.send({ snapshots, total: snapshots.length });
  });

  fastify.post('/pots/:potId/heartbeat/run', async (req, reply) => {
    const { potId } = req.params as { potId: string };

    const settings = await getAutomationSettings(potId);
    if (!settings || !settings.enabled || !settings.heartbeat_enabled) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Heartbeat not enabled for this pot' });
    }

    await enqueueJob({
      job_type: 'heartbeat_generate',
      pot_id: potId,
      payload: { pot_id: potId, manual: true },
      priority: 8,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'heartbeat_run_triggered',
      pot_id: potId,
    });

    logger.info({ pot_id: potId, msg: 'Manual heartbeat run triggered' });
    return reply.status(202).send({ ok: true, message: 'Heartbeat run enqueued' });
  });

  fastify.post('/pots/:potId/heartbeat/render', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const snapshot = await getLatestHeartbeatSnapshot(potId);
    if (!snapshot) {
      return reply.status(404).send({ error: 'NotFound', message: 'No heartbeat snapshot found' });
    }

    await enqueueJob({
      job_type: 'heartbeat_render',
      pot_id: potId,
      payload: { pot_id: potId, snapshot_id: snapshot.id },
      priority: 7,
    });

    return reply.status(202).send({ ok: true, message: 'Heartbeat render enqueued' });
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/tasks', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = req.query as {
      status?: string;
      task_type?: string;
      created_by?: string;
      limit?: string;
      offset?: string;
    };

    const result = await listScheduledTasks(potId, {
      status: query.status as any,
      task_type: query.task_type,
      created_by: query.created_by as any,
      limit: Math.min(Number(query.limit ?? 50), 200),
      offset: Number(query.offset ?? 0),
    });

    return reply.send(result);
  });

  fastify.post('/pots/:potId/tasks', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const body = req.body as Record<string, unknown>;

    const parsed = ScheduledTaskCreateSchema.safeParse({ ...body, pot_id: potId });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.errors });
    }

    const tz = parsed.data.timezone ?? getSystemTimezone() ?? 'UTC';
    const nextRunAt = parsed.data.schedule_kind !== 'manual' && parsed.data.schedule_kind !== 'once'
      ? computeTaskNextRunAt(parsed.data.cron_like ?? null, tz, Date.now())
      : parsed.data.schedule_kind === 'once' && parsed.data.run_at
        ? parsed.data.run_at
        : null;

    const task = await createScheduledTask({
      pot_id: potId,
      task_type: parsed.data.task_type,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      schedule_kind: parsed.data.schedule_kind,
      cron_like: parsed.data.cron_like ?? null,
      run_at: parsed.data.run_at ?? null,
      timezone: parsed.data.timezone,
      payload: parsed.data.payload,
      created_by: 'user',
      created_from: 'settings',
      priority: parsed.data.priority,
      next_run_at: nextRunAt,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'automation_task_created',
      pot_id: potId,
      metadata: { task_id: task.id, title: task.title },
    });

    return reply.status(201).send({ task });
  });

  fastify.patch('/tasks/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const body = req.body as Record<string, unknown>;

    const task = await getScheduledTask(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'NotFound', message: 'Task not found' });
    }

    const parsed = ScheduledTaskUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parsed.error.errors });
    }

    const updated = await updateScheduledTask(taskId, parsed.data);

    await logAuditEvent({
      actor: 'user',
      action: 'automation_task_updated',
      pot_id: task.pot_id,
      metadata: { task_id: taskId, patch: parsed.data },
    });

    return reply.send({ task: updated });
  });

  fastify.post('/tasks/:taskId/complete', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getScheduledTask(taskId);
    if (!task) return reply.status(404).send({ error: 'NotFound', message: 'Task not found' });

    const updated = await updateScheduledTask(taskId, { status: 'completed', next_run_at: null });
    await logAuditEvent({ actor: 'user', action: 'automation_task_completed', pot_id: task.pot_id, metadata: { task_id: taskId } });
    return reply.send({ task: updated });
  });

  fastify.post('/tasks/:taskId/pause', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getScheduledTask(taskId);
    if (!task) return reply.status(404).send({ error: 'NotFound', message: 'Task not found' });

    const updated = await updateScheduledTask(taskId, { status: 'paused' });
    await logAuditEvent({ actor: 'user', action: 'automation_task_paused', pot_id: task.pot_id, metadata: { task_id: taskId } });
    return reply.send({ task: updated });
  });

  fastify.post('/tasks/:taskId/resume', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getScheduledTask(taskId);
    if (!task) return reply.status(404).send({ error: 'NotFound', message: 'Task not found' });

    const tz = task.timezone ?? getSystemTimezone() ?? 'UTC';
    const nextRunAt = task.schedule_kind !== 'manual'
      ? computeTaskNextRunAt(task.cron_like, tz, Date.now())
      : null;

    const updated = await updateScheduledTask(taskId, {
      status: 'active',
      ...(nextRunAt !== null ? { next_run_at: nextRunAt } : {}),
    });

    await logAuditEvent({ actor: 'user', action: 'automation_task_resumed', pot_id: task.pot_id, metadata: { task_id: taskId, next_run_at: nextRunAt } });
    return reply.send({ task: updated });
  });

  fastify.post('/tasks/:taskId/run-now', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getScheduledTask(taskId);
    if (!task) return reply.status(404).send({ error: 'NotFound', message: 'Task not found' });

    // Override next_run_at to now (automation_scheduler will pick it up)
    await updateScheduledTask(taskId, { next_run_at: Date.now() - 1, status: 'active' });

    await logAuditEvent({ actor: 'user', action: 'automation_task_run_now', pot_id: task.pot_id, metadata: { task_id: taskId } });
    return reply.status(202).send({ ok: true, message: 'Task scheduled for immediate run' });
  });

  // ── Seed starter tasks ────────────────────────────────────────────────────

  fastify.post('/pots/:potId/automation/seed-tasks', async (req, reply) => {
    const { potId } = req.params as { potId: string };

    // Load pot's timezone
    const settings = await getAutomationSettings(potId);
    const tz = settings?.timezone ?? getSystemTimezone() ?? 'UTC';

    // Load existing tasks to detect duplicates
    const existing = await listScheduledTasks(potId, { limit: 200 });
    const existingCronTypes = new Set(
      (existing.tasks ?? [])
        .filter((t: { schedule_kind: string }) => t.schedule_kind === 'cron')
        .map((t: { task_type: string }) => t.task_type)
    );

    const STARTER_TASKS = [
      {
        task_type: 'heartbeat',
        title: 'Daily Morning Heartbeat',
        description: 'AI-powered project status snapshot generated each morning.',
        cron_like: 'daily at 09:00',
        priority: 5,
      },
      {
        task_type: 'journal_daily',
        title: 'Daily Research Journal',
        description: 'End-of-day journal entry summarising research progress.',
        cron_like: 'daily at 21:00',
        priority: 8,
      },
      {
        task_type: 'deep_research_run',
        title: 'Weekly Deep Research',
        description: 'Weekly background research sweep to surface new leads.',
        cron_like: 'weekly on MON at 07:00',
        priority: 10,
      },
    ];

    const created: unknown[] = [];
    const skipped: string[] = [];

    for (const starter of STARTER_TASKS) {
      if (existingCronTypes.has(starter.task_type)) {
        skipped.push(starter.task_type);
        continue;
      }

      const nextRunAt = computeTaskNextRunAt(starter.cron_like, tz, Date.now());

      const task = await createScheduledTask({
        pot_id: potId,
        task_type: starter.task_type,
        title: starter.title,
        description: starter.description,
        status: 'active',
        schedule_kind: 'cron',
        cron_like: starter.cron_like,
        run_at: null,
        timezone: tz,
        payload: undefined,
        created_by: 'system',
        created_from: 'automation',
        priority: starter.priority,
        next_run_at: nextRunAt,
      });

      created.push(task);
    }

    if (created.length > 0) {
      await logAuditEvent({
        actor: 'user',
        action: 'automation_seed_tasks_created',
        pot_id: potId,
        metadata: { created_count: created.length, skipped_count: skipped.length },
      });
      logger.info({ pot_id: potId, created: created.length, skipped: skipped.length, msg: 'Seed tasks created' });
    }

    return reply.status(201).send({ created, skipped });
  });

  // ── Diagnostics ───────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/automation/runs', async (req, reply) => {
    const { potId } = req.params as { potId: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(Number(query.limit ?? 50), 200);
    const runs = await listRecentTaskRuns(potId, limit);
    return reply.send({ runs, total: runs.length });
  });

  fastify.get('/automation/diagnostics', async (_req, reply) => {
    // Global overview: enabled pots, recent failures, counts
    return reply.send({
      ok: true,
      message: 'Automation diagnostics',
      timestamp: Date.now(),
    });
  });
};
