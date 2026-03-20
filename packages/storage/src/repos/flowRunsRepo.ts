/**
 * Flow Runs Repository
 *
 * Checkpoint table for tracking the full lifecycle of every user-visible
 * processing flow (doc_upload, image_upload, calendar_alarm, etc.).
 * Used for status dashboards without parsing logs.
 *
 * Migration: 032_flow_runs.sql
 */

import { getDatabase } from '../db.js';
import type { FlowRun, CreateFlowRunInput } from '../types.js';

function toFlowRun(row: any): FlowRun {
  return {
    id: row.id,
    flow_type: row.flow_type,
    status: row.status,
    pot_id: row.pot_id ?? null,
    entry_id: row.entry_id ?? null,
    started_at: row.started_at,
    completed_at: row.completed_at ?? null,
    last_stage: row.last_stage ?? null,
    last_event: row.last_event ?? null,
    error_summary: row.error_summary ?? null,
  };
}

/**
 * Create a new flow run record (called at flow start).
 */
export async function createFlowRun(input: CreateFlowRunInput): Promise<FlowRun> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .insertInto('flow_runs')
    .values({
      id: input.id,
      flow_type: input.flow_type,
      status: 'started',
      pot_id: input.pot_id ?? null,
      entry_id: input.entry_id ?? null,
      started_at: now,
      completed_at: null,
      last_stage: null,
      last_event: null,
      error_summary: null,
    })
    .execute();

  const row = await db
    .selectFrom('flow_runs')
    .selectAll()
    .where('id', '=', input.id)
    .executeTakeFirst();

  return toFlowRun(row);
}

/**
 * Advance a flow run to a new stage (called between job transitions).
 */
export async function advanceFlowRun(
  flowId: string,
  stage: string,
  event: string,
): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('flow_runs')
    .set({ last_stage: stage, last_event: event })
    .where('id', '=', flowId)
    .execute();
}

/**
 * Mark a flow run as successfully completed.
 */
export async function completeFlowRun(flowId: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .updateTable('flow_runs')
    .set({ status: 'completed', completed_at: now })
    .where('id', '=', flowId)
    .execute();
}

/**
 * Mark a flow run as failed with an error summary.
 */
export async function failFlowRun(flowId: string, error: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .updateTable('flow_runs')
    .set({
      status: 'failed',
      completed_at: now,
      error_summary: error.substring(0, 500),
    })
    .where('id', '=', flowId)
    .execute();
}

/**
 * Get a flow run by ID.
 */
export async function getFlowRun(flowId: string): Promise<FlowRun | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('flow_runs')
    .selectAll()
    .where('id', '=', flowId)
    .executeTakeFirst();

  return row ? toFlowRun(row) : null;
}
