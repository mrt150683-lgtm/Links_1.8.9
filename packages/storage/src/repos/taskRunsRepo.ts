/**
 * taskRunsRepo
 *
 * CRUD for task_runs — execution history for scheduled_tasks.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { CreateTaskRunInput } from '../types.js';

// ── Local TaskRun type (mirrors @links/core automation-schemas) ──────────────
export interface TaskRun {
  id: string;
  task_id: string;
  pot_id: string;
  job_id: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  started_at: number | null;
  finished_at: number | null;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  result: unknown;
  error_text: string | null;
  created_at: number;
}

function rowToRun(row: any): TaskRun {
  return {
    id: row.id,
    task_id: row.task_id,
    pot_id: row.pot_id,
    job_id: row.job_id ?? null,
    status: row.status as TaskRun['status'],
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    model_id: row.model_id ?? null,
    prompt_id: row.prompt_id ?? null,
    prompt_version: row.prompt_version ?? null,
    tokens_in: row.tokens_in ?? 0,
    tokens_out: row.tokens_out ?? 0,
    cost_estimate: row.cost_estimate ?? 0,
    result: row.result_json && row.result_json !== 'null'
      ? JSON.parse(row.result_json)
      : null,
    error_text: row.error_text ?? null,
    created_at: row.created_at,
  };
}

export async function createTaskRun(input: CreateTaskRunInput): Promise<TaskRun> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db
    .insertInto('task_runs')
    .values({
      id,
      task_id: input.task_id,
      pot_id: input.pot_id,
      job_id: input.job_id ?? null,
      status: input.status ?? 'pending',
      started_at: null,
      finished_at: null,
      model_id: input.model_id ?? null,
      prompt_id: input.prompt_id ?? null,
      prompt_version: input.prompt_version ?? null,
      tokens_in: 0,
      tokens_out: 0,
      cost_estimate: 0.0,
      result_json: 'null',
      error_text: null,
      created_at: now,
    })
    .execute();

  return (await getTaskRun(id))!;
}

export async function getTaskRun(id: string): Promise<TaskRun | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('task_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToRun(row) : null;
}

export async function updateTaskRun(
  id: string,
  patch: Partial<{
    status: TaskRun['status'];
    started_at: number | null;
    finished_at: number | null;
    model_id: string | null;
    prompt_id: string | null;
    prompt_version: string | null;
    tokens_in: number;
    tokens_out: number;
    cost_estimate: number;
    result: unknown;
    error_text: string | null;
  }>,
): Promise<void> {
  const db = getDatabase();
  const updates: Record<string, unknown> = {};

  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.started_at !== undefined) updates.started_at = patch.started_at;
  if (patch.finished_at !== undefined) updates.finished_at = patch.finished_at;
  if (patch.model_id !== undefined) updates.model_id = patch.model_id;
  if (patch.prompt_id !== undefined) updates.prompt_id = patch.prompt_id;
  if (patch.prompt_version !== undefined) updates.prompt_version = patch.prompt_version;
  if (patch.tokens_in !== undefined) updates.tokens_in = patch.tokens_in;
  if (patch.tokens_out !== undefined) updates.tokens_out = patch.tokens_out;
  if (patch.cost_estimate !== undefined) updates.cost_estimate = patch.cost_estimate;
  if (patch.result !== undefined) updates.result_json = JSON.stringify(patch.result);
  if (patch.error_text !== undefined) updates.error_text = patch.error_text;

  if (Object.keys(updates).length === 0) return;

  await db.updateTable('task_runs').set(updates).where('id', '=', id).execute();
}

export async function listTaskRuns(taskId: string, limit = 20): Promise<TaskRun[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('task_runs')
    .selectAll()
    .where('task_id', '=', taskId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToRun);
}

export async function listRecentTaskRuns(potId: string, limit = 50): Promise<TaskRun[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('task_runs')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToRun);
}
