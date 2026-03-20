/**
 * scheduledTasksRepo
 *
 * CRUD + scheduling logic for scheduled_tasks.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { CreateScheduledTaskInput } from '../types.js';

// ── Local ScheduledTask types ─────────────────────────────────────────────────
export interface ScheduledTask {
  id: string;
  pot_id: string;
  task_type: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'canceled';
  schedule_kind: 'cron' | 'once' | 'manual' | 'event';
  cron_like: string | null;
  run_at: number | null;
  timezone: string;
  payload: Record<string, unknown>;
  created_by: 'user' | 'system' | 'agent';
  created_from: 'chat' | 'settings' | 'automation' | 'migration';
  last_run_at: number | null;
  next_run_at: number | null;
  last_result_status: string | null;
  last_result_summary: string | null;
  priority: number;
  locked_by: string | null;
  locked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ScheduledTaskUpdate {
  title?: string;
  description?: string;
  status?: ScheduledTask['status'];
  schedule_kind?: ScheduledTask['schedule_kind'];
  cron_like?: string | null;
  run_at?: number | null;
  timezone?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  next_run_at?: number | null;
}

function rowToTask(row: any): ScheduledTask {
  return {
    id: row.id,
    pot_id: row.pot_id,
    task_type: row.task_type,
    title: row.title,
    description: row.description,
    status: row.status as ScheduledTask['status'],
    schedule_kind: row.schedule_kind as ScheduledTask['schedule_kind'],
    cron_like: row.cron_like ?? null,
    run_at: row.run_at ?? null,
    timezone: row.timezone,
    payload: row.payload_json && row.payload_json !== '{}'
      ? JSON.parse(row.payload_json)
      : {},
    created_by: row.created_by as ScheduledTask['created_by'],
    created_from: row.created_from as ScheduledTask['created_from'],
    last_run_at: row.last_run_at ?? null,
    next_run_at: row.next_run_at ?? null,
    last_result_status: row.last_result_status ?? null,
    last_result_summary: row.last_result_summary ?? null,
    priority: row.priority,
    locked_by: row.locked_by ?? null,
    locked_at: row.locked_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  // Compute initial next_run_at
  const nextRunAt = input.next_run_at !== undefined
    ? input.next_run_at
    : input.schedule_kind === 'once' && input.run_at
      ? input.run_at
      : input.schedule_kind === 'manual'
        ? null
        : null;

  await db
    .insertInto('scheduled_tasks')
    .values({
      id,
      pot_id: input.pot_id,
      task_type: input.task_type ?? 'custom_prompt_task',
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'active',
      schedule_kind: input.schedule_kind ?? 'manual',
      cron_like: input.cron_like ?? null,
      run_at: input.run_at ?? null,
      timezone: input.timezone ?? 'UTC',
      payload_json: JSON.stringify(input.payload ?? {}),
      created_by: input.created_by ?? 'user',
      created_from: input.created_from ?? 'settings',
      last_run_at: null,
      next_run_at: nextRunAt ?? null,
      last_result_status: null,
      last_result_summary: null,
      priority: input.priority ?? 10,
      locked_by: null,
      locked_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return (await getScheduledTask(id))!;
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('scheduled_tasks')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToTask(row) : null;
}

export async function listScheduledTasks(
  potId: string,
  filters?: {
    status?: ScheduledTask['status'];
    task_type?: string;
    created_by?: ScheduledTask['created_by'];
    limit?: number;
    offset?: number;
  },
): Promise<{ tasks: ScheduledTask[]; total: number }> {
  const db = getDatabase();

  let query = db
    .selectFrom('scheduled_tasks')
    .selectAll()
    .where('pot_id', '=', potId);

  if (filters?.status) query = query.where('status', '=', filters.status);
  if (filters?.task_type) query = query.where('task_type', '=', filters.task_type);
  if (filters?.created_by) query = query.where('created_by', '=', filters.created_by);

  const totalRow = await query
    .clearSelect()
    .select(db.fn.count('id').as('count'))
    .executeTakeFirst();
  const total = Number(totalRow?.count ?? 0);

  const tasks = await query
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'desc')
    .limit(filters?.limit ?? 100)
    .offset(filters?.offset ?? 0)
    .execute();

  return { tasks: tasks.map(rowToTask), total };
}

export async function updateScheduledTask(
  id: string,
  patch: ScheduledTaskUpdate & { last_run_at?: number; last_result_status?: string; last_result_summary?: string; locked_by?: string | null; locked_at?: number | null },
): Promise<ScheduledTask | null> {
  const db = getDatabase();
  const now = Date.now();
  const updates: Record<string, unknown> = { updated_at: now };

  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.schedule_kind !== undefined) updates.schedule_kind = patch.schedule_kind;
  if (patch.cron_like !== undefined) updates.cron_like = patch.cron_like;
  if (patch.run_at !== undefined) updates.run_at = patch.run_at;
  if (patch.timezone !== undefined) updates.timezone = patch.timezone;
  if (patch.payload !== undefined) updates.payload_json = JSON.stringify(patch.payload);
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.next_run_at !== undefined) updates.next_run_at = patch.next_run_at;
  if (patch.last_run_at !== undefined) updates.last_run_at = patch.last_run_at;
  if (patch.last_result_status !== undefined) updates.last_result_status = patch.last_result_status;
  if (patch.last_result_summary !== undefined) updates.last_result_summary = patch.last_result_summary;
  if ('locked_by' in patch) updates.locked_by = patch.locked_by;
  if ('locked_at' in patch) updates.locked_at = patch.locked_at;

  await db.updateTable('scheduled_tasks').set(updates).where('id', '=', id).execute();
  return getScheduledTask(id);
}

export async function claimScheduledTask(id: string, workerId: string): Promise<boolean> {
  const db = getDatabase();
  const now = Date.now();

  // Atomic claim: only claim if not locked
  const result = await db
    .updateTable('scheduled_tasks')
    .set({ locked_by: workerId, locked_at: now, updated_at: now })
    .where('id', '=', id)
    .where('locked_by', 'is', null)
    .execute();

  return (result as any).numUpdatedRows > 0 || (result[0] as any)?.numUpdatedRows > 0;
}

export async function releaseScheduledTask(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('scheduled_tasks')
    .set({ locked_by: null, locked_at: null, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

export async function listDueTasks(nowMs: number): Promise<ScheduledTask[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('scheduled_tasks')
    .selectAll()
    .where('status', '=', 'active')
    .where('next_run_at', '<=', nowMs)
    .where('locked_by', 'is', null)
    .orderBy('priority', 'asc')
    .orderBy('next_run_at', 'asc')
    .limit(50)
    .execute();
  return rows.map(rowToTask);
}

export async function countHeartbeatRunsToday(potId: string): Promise<number> {
  const db = getDatabase();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const row = await db
    .selectFrom('task_runs')
    .innerJoin('scheduled_tasks', 'scheduled_tasks.id', 'task_runs.task_id')
    .select(db.fn.count('task_runs.id').as('count'))
    .where('scheduled_tasks.pot_id', '=', potId)
    .where('scheduled_tasks.task_type', '=', 'heartbeat')
    .where('task_runs.created_at', '>=', dayStart.getTime())
    .where('task_runs.status', 'in', ['done', 'running'])
    .executeTakeFirst();

  return Number(row?.count ?? 0);
}

export async function countTaskCreationsToday(potId: string): Promise<number> {
  const db = getDatabase();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const row = await db
    .selectFrom('scheduled_tasks')
    .select(db.fn.count('id').as('count'))
    .where('pot_id', '=', potId)
    .where('created_by', '=', 'agent')
    .where('created_at', '>=', dayStart.getTime())
    .executeTakeFirst();

  return Number(row?.count ?? 0);
}

export async function releaseStaleTaskLocks(maxLockAgeMs: number): Promise<number> {
  const db = getDatabase();
  const cutoff = Date.now() - maxLockAgeMs;
  const result = await db
    .updateTable('scheduled_tasks')
    .set({ locked_by: null, locked_at: null, updated_at: Date.now() })
    .where('locked_at', '<=', cutoff)
    .execute();

  return Number((result as any).numUpdatedRows ?? (result[0] as any)?.numUpdatedRows ?? 0);
}

// computeTaskNextRunAt is imported from ../lib/cronUtils.js
export { computeTaskNextRunAt } from '../lib/cronUtils.js';
