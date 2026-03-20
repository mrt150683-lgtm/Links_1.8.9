/**
 * Chat Runs Repository
 *
 * Tracks MoM (Mixture of Models) chat orchestration runs, their agents,
 * reviews, and events for full local traceability.
 *
 * Migration: 033_mom_chat_runs.sql
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db.js';
import type {
  ChatRun,
  ChatRunAgent,
  ChatRunReview,
  CreateChatRunInput,
  CreateChatRunAgentInput,
  CreateChatRunReviewInput,
} from '../types.js';

// ── Mappers ──────────────────────────────────────────────────────────

function toChatRun(row: any): ChatRun {
  return {
    id: row.id,
    thread_id: row.thread_id,
    pot_id: row.pot_id ?? null,
    user_message_id: row.user_message_id ?? null,
    chat_surface: row.chat_surface,
    execution_mode: row.execution_mode,
    status: row.status,
    planner_model_id: row.planner_model_id ?? null,
    merge_model_id: row.merge_model_id ?? null,
    planner_output: row.planner_output_json ? JSON.parse(row.planner_output_json) : null,
    final_output: row.final_output_json ? JSON.parse(row.final_output_json) : null,
    context_fingerprint: row.context_fingerprint ?? null,
    error_message: row.error_message ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
  };
}

function toChatRunAgent(row: any): ChatRunAgent {
  return {
    id: row.id,
    chat_run_id: row.chat_run_id,
    agent_index: row.agent_index,
    agent_role: row.agent_role,
    model_id: row.model_id,
    status: row.status,
    input_hash: row.input_hash ?? null,
    output: row.output_json ? JSON.parse(row.output_json) : null,
    latency_ms: row.latency_ms ?? null,
    token_usage: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
  };
}

// ── Chat Run CRUD ────────────────────────────────────────────────────

export async function createChatRun(input: CreateChatRunInput): Promise<ChatRun> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('chat_runs')
    .values({
      id,
      thread_id: input.thread_id,
      pot_id: input.pot_id ?? null,
      user_message_id: input.user_message_id ?? null,
      chat_surface: input.chat_surface,
      execution_mode: input.execution_mode,
      status: 'pending',
      planner_model_id: null,
      merge_model_id: null,
      planner_output_json: null,
      final_output_json: null,
      context_fingerprint: input.context_fingerprint ?? null,
      error_message: null,
      created_at: now,
      updated_at: now,
      started_at: now,
      finished_at: null,
    })
    .execute();

  const row = await db
    .selectFrom('chat_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toChatRun(row);
}

export async function updateChatRunStatus(
  id: string,
  status: ChatRun['status'],
  opts?: { error_message?: string; finished_at?: number },
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .updateTable('chat_runs')
    .set({
      status,
      updated_at: now,
      ...(opts?.error_message !== undefined ? { error_message: opts.error_message } : {}),
      ...(opts?.finished_at !== undefined ? { finished_at: opts.finished_at } : {}),
    })
    .where('id', '=', id)
    .execute();
}

export async function updateChatRunPlanner(
  id: string,
  plannerOutput: Record<string, unknown>,
  modelId: string,
): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('chat_runs')
    .set({
      planner_output_json: JSON.stringify(plannerOutput),
      planner_model_id: modelId,
      status: 'running',
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function updateChatRunFinalOutput(
  id: string,
  output: Record<string, unknown>,
  mergeModelId: string,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .updateTable('chat_runs')
    .set({
      final_output_json: JSON.stringify(output),
      merge_model_id: mergeModelId,
      status: 'done',
      updated_at: now,
      finished_at: now,
    })
    .where('id', '=', id)
    .execute();
}

export async function cancelChatRun(id: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('chat_runs')
    .set({ status: 'cancelled', updated_at: now, finished_at: now })
    .where('id', '=', id)
    .where('status', 'not in', ['done', 'failed', 'cancelled'])
    .execute();
}

export async function getChatRun(id: string): Promise<ChatRun | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('chat_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? toChatRun(row) : null;
}

// ── Chat Run Agents ──────────────────────────────────────────────────

export async function createChatRunAgent(input: CreateChatRunAgentInput): Promise<ChatRunAgent> {
  const db = getDatabase();
  const id = randomUUID();

  await db
    .insertInto('chat_run_agents')
    .values({
      id,
      chat_run_id: input.chat_run_id,
      agent_index: input.agent_index,
      agent_role: input.agent_role,
      model_id: input.model_id,
      status: 'pending',
      input_hash: input.input_hash ?? null,
      output_json: null,
      latency_ms: null,
      token_usage_json: null,
      error_message: null,
      started_at: Date.now(),
      finished_at: null,
    })
    .execute();

  const row = await db
    .selectFrom('chat_run_agents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toChatRunAgent(row);
}

export async function updateChatRunAgent(
  id: string,
  updates: {
    status: ChatRunAgent['status'];
    output?: Record<string, unknown>;
    latency_ms?: number;
    token_usage?: Record<string, unknown>;
    error_message?: string;
  },
): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('chat_run_agents')
    .set({
      status: updates.status,
      ...(updates.output !== undefined ? { output_json: JSON.stringify(updates.output) } : {}),
      ...(updates.latency_ms !== undefined ? { latency_ms: updates.latency_ms } : {}),
      ...(updates.token_usage !== undefined ? { token_usage_json: JSON.stringify(updates.token_usage) } : {}),
      ...(updates.error_message !== undefined ? { error_message: updates.error_message } : {}),
      finished_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function listChatRunAgents(runId: string): Promise<ChatRunAgent[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('chat_run_agents')
    .selectAll()
    .where('chat_run_id', '=', runId)
    .orderBy('agent_index', 'asc')
    .execute();

  return rows.map(toChatRunAgent);
}

// ── Chat Run Events ──────────────────────────────────────────────────

export async function insertChatRunEvent(
  runId: string,
  eventType: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const db = getDatabase();

  await db
    .insertInto('chat_run_events')
    .values({
      id: randomUUID(),
      chat_run_id: runId,
      event_type: eventType,
      payload_json: payload ? JSON.stringify(payload) : null,
      created_at: Date.now(),
    })
    .execute();
}

export async function listChatRunEvents(runId: string): Promise<Array<{
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: number;
}>> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('chat_run_events')
    .selectAll()
    .where('chat_run_id', '=', runId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    event_type: r.event_type,
    payload: r.payload_json ? JSON.parse(r.payload_json as string) : null,
    created_at: r.created_at,
  }));
}

// ── Chat Run Reviews (Phase 2) ───────────────────────────────────────

function toChatRunReview(row: any): ChatRunReview {
  return {
    id: row.id,
    chat_run_id: row.chat_run_id,
    reviewer_agent_id: row.reviewer_agent_id ?? null,
    target_agent_id: row.target_agent_id ?? null,
    model_id: row.model_id,
    review_output: row.review_output_json ? JSON.parse(row.review_output_json) : null,
    latency_ms: row.latency_ms ?? null,
    token_usage: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    created_at: row.created_at,
  };
}

export async function createChatRunReview(input: CreateChatRunReviewInput): Promise<ChatRunReview> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db
    .insertInto('chat_run_reviews')
    .values({
      id,
      chat_run_id: input.chat_run_id,
      reviewer_agent_id: input.reviewer_agent_id ?? null,
      target_agent_id: input.target_agent_id ?? null,
      model_id: input.model_id,
      review_output_json: null,
      latency_ms: null,
      token_usage_json: null,
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('chat_run_reviews')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toChatRunReview(row);
}

export async function updateChatRunReview(
  id: string,
  updates: {
    review_output: Record<string, unknown>;
    latency_ms: number;
    token_usage?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('chat_run_reviews')
    .set({
      review_output_json: JSON.stringify(updates.review_output),
      latency_ms: updates.latency_ms,
      ...(updates.token_usage !== undefined ? { token_usage_json: JSON.stringify(updates.token_usage) } : {}),
    })
    .where('id', '=', id)
    .execute();
}

export async function listChatRunReviews(runId: string): Promise<ChatRunReview[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('chat_run_reviews')
    .selectAll()
    .where('chat_run_id', '=', runId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(toChatRunReview);
}
