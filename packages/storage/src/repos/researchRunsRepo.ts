/**
 * Research Runs Repository
 *
 * CRUD and state management for deep research agent runs.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { ResearchRun, CreateResearchRunInput, ResearchRunStatus } from '../types.js';

function toRun(row: any): ResearchRun {
  return {
    id: row.id,
    pot_id: row.pot_id,
    status: row.status,
    goal_prompt: row.goal_prompt,
    config: tryParse(row.config_json, {}),
    selected_model: row.selected_model ?? null,
    model_overrides: row.model_overrides_json ? tryParse(row.model_overrides_json, null) : null,
    plan_artifact_id: row.plan_artifact_id ?? null,
    plan_approved_at: row.plan_approved_at ?? null,
    plan_approved_by: row.plan_approved_by ?? null,
    checkpoint_artifact_id: row.checkpoint_artifact_id ?? null,
    checkpoint: row.checkpoint_json ? tryParse(row.checkpoint_json, null) : null,
    progress: tryParse(row.progress_json, {}),
    budget_usage: tryParse(row.budget_usage_json, {}),
    previous_run_id: row.previous_run_id ?? null,
    model_id: row.model_id ?? null,
    prompt_ids: row.prompt_ids_json ? tryParse(row.prompt_ids_json, null) : null,
    entries_read: row.entries_read_json ? tryParse(row.entries_read_json, null) : null,
    sources_ingested: row.sources_ingested_json ? tryParse(row.sources_ingested_json, null) : null,
    report_artifact_id: row.report_artifact_id ?? null,
    delta_artifact_id: row.delta_artifact_id ?? null,
    novelty_artifact_id: row.novelty_artifact_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
  };
}

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * Create a new research run in 'draft' status
 */
export async function createResearchRun(input: CreateResearchRunInput): Promise<ResearchRun> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('research_runs')
    .values({
      id,
      pot_id: input.pot_id,
      status: 'draft',
      goal_prompt: input.goal_prompt,
      config_json: JSON.stringify(input.config ?? {}),
      selected_model: input.selected_model ?? null,
      model_overrides_json: input.model_overrides ? JSON.stringify(input.model_overrides) : null,
      plan_artifact_id: null,
      plan_approved_at: null,
      plan_approved_by: null,
      checkpoint_artifact_id: null,
      checkpoint_json: null,
      progress_json: '{}',
      budget_usage_json: '{}',
      previous_run_id: input.previous_run_id ?? null,
      model_id: null,
      prompt_ids_json: null,
      entries_read_json: null,
      sources_ingested_json: null,
      report_artifact_id: null,
      delta_artifact_id: null,
      novelty_artifact_id: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    })
    .execute();

  return getResearchRunOrThrow(id);
}

/**
 * Get a research run by ID
 */
export async function getResearchRun(id: string): Promise<ResearchRun | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('research_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? toRun(row) : null;
}

export async function getResearchRunOrThrow(id: string): Promise<ResearchRun> {
  const run = await getResearchRun(id);
  if (!run) throw new Error(`Research run not found: ${id}`);
  return run;
}

/**
 * List research runs for a pot
 */
export async function listResearchRuns(
  potId: string,
  opts: { status?: ResearchRunStatus; limit?: number; offset?: number } = {}
): Promise<{ runs: ResearchRun[]; total: number }> {
  const db = getDatabase();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  let q = db.selectFrom('research_runs').selectAll().where('pot_id', '=', potId);
  if (opts.status) q = q.where('status', '=', opts.status);

  const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

  let countQ = db
    .selectFrom('research_runs')
    .select(db.fn.count<number>('id').as('count'))
    .where('pot_id', '=', potId);
  if (opts.status) countQ = countQ.where('status', '=', opts.status);
  const countRow = await countQ.executeTakeFirst();

  return {
    runs: rows.map(toRun),
    total: Number(countRow?.count ?? 0),
  };
}

/**
 * Update run status
 */
export async function updateResearchRunStatus(
  id: string,
  status: ResearchRunStatus,
  extra?: {
    started_at?: number;
    finished_at?: number;
  }
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('research_runs')
    .set({
      status,
      updated_at: Date.now(),
      ...(extra?.started_at !== undefined ? { started_at: extra.started_at } : {}),
      ...(extra?.finished_at !== undefined ? { finished_at: extra.finished_at } : {}),
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Set the plan artifact on a run
 */
export async function setResearchRunPlan(
  id: string,
  planArtifactId: string
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('research_runs')
    .set({
      plan_artifact_id: planArtifactId,
      status: 'awaiting_approval',
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Approve the plan on a run
 */
export async function approveResearchRunPlan(
  id: string,
  configOverride?: Record<string, unknown>
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const updates: Record<string, unknown> = {
    plan_approved_at: now,
    plan_approved_by: 'user',
    status: 'queued',
    updated_at: now,
  };

  if (configOverride) {
    // Merge config override into existing config
    const existing = await db.selectFrom('research_runs').select('config_json').where('id', '=', id).executeTakeFirst();
    const currentConfig = existing?.config_json ? JSON.parse(existing.config_json) : {};
    updates.config_json = JSON.stringify({ ...currentConfig, ...configOverride });
  }

  await db.updateTable('research_runs').set(updates as any).where('id', '=', id).execute();
}

/**
 * Update run progress (lightweight polling field)
 */
export async function updateResearchRunProgress(
  id: string,
  progress: Record<string, unknown>,
  budgetUsage?: Record<string, unknown>
): Promise<void> {
  const db = getDatabase();
  const updates: Record<string, unknown> = {
    progress_json: JSON.stringify(progress),
    updated_at: Date.now(),
  };
  if (budgetUsage) {
    updates.budget_usage_json = JSON.stringify(budgetUsage);
  }
  await db.updateTable('research_runs').set(updates as any).where('id', '=', id).execute();
}

/**
 * Update run checkpoint (light checkpoint in row + artifact reference)
 */
export async function updateResearchRunCheckpoint(
  id: string,
  checkpoint: Record<string, unknown>,
  checkpointArtifactId: string
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('research_runs')
    .set({
      checkpoint_json: JSON.stringify(checkpoint),
      checkpoint_artifact_id: checkpointArtifactId,
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Set output artifact references after execution completes
 */
export async function setResearchRunArtifacts(
  id: string,
  opts: {
    report_artifact_id?: string;
    delta_artifact_id?: string;
    novelty_artifact_id?: string;
    model_id?: string;
    prompt_ids?: string[];
    entries_read?: Array<{ id: string; sha256: string }>;
    sources_ingested?: Array<{ url: string; sha256: string; entry_id: string }>;
  }
): Promise<void> {
  const db = getDatabase();
  const updates: Record<string, unknown> = { updated_at: Date.now() };

  if (opts.report_artifact_id) updates.report_artifact_id = opts.report_artifact_id;
  if (opts.delta_artifact_id) updates.delta_artifact_id = opts.delta_artifact_id;
  if (opts.novelty_artifact_id) updates.novelty_artifact_id = opts.novelty_artifact_id;
  if (opts.model_id) updates.model_id = opts.model_id;
  if (opts.prompt_ids) updates.prompt_ids_json = JSON.stringify(opts.prompt_ids);

  // Cap inline lists at 500/100 entries
  if (opts.entries_read) {
    const capped = opts.entries_read.slice(0, 500);
    updates.entries_read_json = JSON.stringify(capped);
  }
  if (opts.sources_ingested) {
    const capped = opts.sources_ingested.slice(0, 100);
    updates.sources_ingested_json = JSON.stringify(capped);
  }

  await db.updateTable('research_runs').set(updates as any).where('id', '=', id).execute();
}

/**
 * Cancel a research run
 */
export async function cancelResearchRun(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('research_runs')
    .set({ status: 'cancelled', updated_at: Date.now(), finished_at: Date.now() })
    .where('id', '=', id)
    .where('status', 'not in', ['done', 'failed', 'cancelled'])
    .execute();
}

/**
 * Check if a pot has an active run (to prevent scheduler duplicates)
 */
export async function hasActiveResearchRun(potId: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db
    .selectFrom('research_runs')
    .select('id')
    .where('pot_id', '=', potId)
    .where('status', 'in', ['planning', 'awaiting_approval', 'queued', 'running', 'paused'])
    .limit(1)
    .executeTakeFirst();

  return row !== undefined;
}

/**
 * Get the most recent completed run for a pot (for delta computation)
 */
export async function getLastCompletedResearchRun(
  potId: string,
  excludeRunId?: string
): Promise<ResearchRun | null> {
  const db = getDatabase();
  let q = db
    .selectFrom('research_runs')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', '=', 'done');

  if (excludeRunId) {
    q = q.where('id', '!=', excludeRunId);
  }

  const row = await q.orderBy('finished_at', 'desc').limit(1).executeTakeFirst();
  return row ? toRun(row) : null;
}
