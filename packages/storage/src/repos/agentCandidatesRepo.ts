/**
 * Agent Candidates Repository
 *
 * CRUD for:
 *   - agent_candidates     (AI-generated surprise candidates)
 *   - agent_feedback_events (user feedback on candidates)
 *
 * Migration: 040_agent_core.sql
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  AgentCandidate,
  AgentFeedbackEvent,
  AgentFeedbackAction,
  AgentCandidatesTable,
  CreateAgentCandidateInput,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toAgentCandidate(row: any): AgentCandidate {
  return {
    id: row.id,
    pot_id: row.pot_id,
    run_id: row.run_id,
    candidate_type: row.candidate_type,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    novelty: row.novelty,
    relevance: row.relevance,
    evidence_score: row.evidence_score,
    cost_score: row.cost_score,
    fatigue_score: row.fatigue_score,
    final_score: row.final_score,
    status: row.status,
    signature: row.signature,
    source_refs: row.source_refs_json ? JSON.parse(row.source_refs_json) : [],
    launch_payload: row.launch_payload_json ? JSON.parse(row.launch_payload_json) : null,
    delivered_at: row.delivered_at,
    next_eligible_at: row.next_eligible_at,
    created_at: row.created_at as number,
  };
}

function toAgentFeedbackEvent(row: any): AgentFeedbackEvent {
  return {
    id: row.id,
    pot_id: row.pot_id,
    candidate_id: row.candidate_id,
    action: row.action,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    created_at: row.created_at as number,
  };
}

// ── Signature ─────────────────────────────────────────────────────────────

export function computeCandidateSignature(
  title: string,
  body: string,
  candidateType: string,
): string {
  return createHash('sha256')
    .update(`${candidateType}::${title}::${body}`)
    .digest('hex')
    .slice(0, 32);
}

// ── Agent Candidates ──────────────────────────────────────────────────────

export async function insertAgentCandidates(
  runId: string,
  potId: string,
  items: CreateAgentCandidateInput[],
): Promise<AgentCandidate[]> {
  const db = getDatabase();
  const now = Date.now();
  const ids: string[] = [];

  for (const item of items) {
    const id = randomUUID();
    ids.push(id);
    const signature = computeCandidateSignature(item.title, item.body, item.candidate_type);
    await db
      .insertInto('agent_candidates')
      .values({
        id,
        pot_id: potId,
        run_id: runId,
        candidate_type: item.candidate_type,
        title: item.title,
        body: item.body,
        confidence: item.confidence ?? 0.5,
        novelty: item.novelty ?? 0.5,
        relevance: item.relevance ?? 0.5,
        evidence_score: item.evidence_score ?? 0.5,
        cost_score: item.cost_score ?? 0.5,
        fatigue_score: item.fatigue_score ?? 0,
        final_score: item.final_score ?? 0.5,
        status: 'pending',
        signature,
        source_refs_json: item.source_refs ? JSON.stringify(item.source_refs) : '[]',
        launch_payload_json: item.launch_payload ? JSON.stringify(item.launch_payload) : 'null',
        delivered_at: null,
        next_eligible_at: 0,
        created_at: now,
      })
      .execute();
  }

  const rows = await db
    .selectFrom('agent_candidates')
    .selectAll()
    .where('id', 'in', ids)
    .execute();
  return rows.map(toAgentCandidate);
}

export async function getAgentCandidate(id: string): Promise<AgentCandidate | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_candidates')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toAgentCandidate(row) : null;
}

export async function listAgentCandidates(
  potId: string,
  opts?: {
    status?: string;
    candidate_type?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ candidates: AgentCandidate[]; total: number }> {
  const db = getDatabase();
  let query = db.selectFrom('agent_candidates').selectAll().where('pot_id', '=', potId);
  let countQuery = db
    .selectFrom('agent_candidates')
    .select(db.fn.countAll().as('count'))
    .where('pot_id', '=', potId);

  if (opts?.status) {
    query = query.where('status', '=', opts.status as AgentCandidatesTable['status']);
    countQuery = countQuery.where('status', '=', opts.status as AgentCandidatesTable['status']);
  }
  if (opts?.candidate_type) {
    query = query.where('candidate_type', '=', opts.candidate_type as AgentCandidatesTable['candidate_type']);
    countQuery = countQuery.where('candidate_type', '=', opts.candidate_type as AgentCandidatesTable['candidate_type']);
  }

  const [rows, countRow] = await Promise.all([
    query
      .orderBy('final_score', 'desc')
      .orderBy('created_at', 'desc')
      .limit(opts?.limit ?? 20)
      .offset(opts?.offset ?? 0)
      .execute(),
    countQuery.executeTakeFirst(),
  ]);

  return {
    candidates: rows.map(toAgentCandidate),
    total: Number(countRow?.count ?? 0),
  };
}

export async function getNextDeliveryCandidate(potId: string): Promise<AgentCandidate | null> {
  const db = getDatabase();
  const now = Date.now();
  const row = await db
    .selectFrom('agent_candidates')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', '=', 'selected')
    .where((eb) =>
      eb.or([eb('next_eligible_at', 'is', null), eb('next_eligible_at', '<=', now)]),
    )
    .orderBy('final_score', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? toAgentCandidate(row) : null;
}

export async function markCandidateDelivered(id: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('agent_candidates')
    .set({ status: 'delivered', delivered_at: now })
    .where('id', '=', id)
    .execute();
}

export async function markCandidateSelected(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_candidates')
    .set({ status: 'selected' })
    .where('id', '=', id)
    .execute();
}

export async function snoozeCandidate(id: string, snoozeHours: number): Promise<void> {
  const db = getDatabase();
  const nextEligibleAt = Date.now() + snoozeHours * 3_600_000;
  await db
    .updateTable('agent_candidates')
    .set({ status: 'snoozed', next_eligible_at: nextEligibleAt })
    .where('id', '=', id)
    .execute();
}

export async function archiveCandidate(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_candidates')
    .set({ status: 'archived' })
    .where('id', '=', id)
    .execute();
}

export async function rejectCandidate(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_candidates')
    .set({ status: 'rejected' })
    .where('id', '=', id)
    .execute();
}

export async function hasDeliveredTodayForPot(potId: string): Promise<boolean> {
  const db = getDatabase();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = await db
    .selectFrom('agent_candidates')
    .select('id')
    .where('pot_id', '=', potId)
    .where('status', '=', 'delivered')
    .where('delivered_at', '>=', startOfDay.getTime())
    .executeTakeFirst();
  return !!row;
}

export async function checkSignatureDedup(potId: string, signature: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_candidates')
    .select('id')
    .where('pot_id', '=', potId)
    .where('signature', '=', signature)
    .where('status', 'not in', ['rejected', 'archived'] as AgentCandidatesTable['status'][])
    .executeTakeFirst();
  return !!row;
}

// ── Feedback ──────────────────────────────────────────────────────────────

export async function recordFeedback(
  potId: string,
  candidateId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  await db
    .insertInto('agent_feedback_events')
    .values({
      id,
      pot_id: potId,
      candidate_id: candidateId,
      action: action as AgentFeedbackAction,
      metadata_json: metadata ? JSON.stringify(metadata) : '{}',
      created_at: now,
    })
    .execute();

  // Update candidate status based on action
  if (action === 'cool' || action === 'interested') {
    await db
      .updateTable('agent_candidates')
      .set({ status: 'delivered' })
      .where('id', '=', candidateId)
      .execute();
  } else if (action === 'meh' || action === 'useless' || action === 'known') {
    await archiveCandidate(candidateId);
  } else if (action === 'snooze') {
    await snoozeCandidate(candidateId, 24);
  } else if (action === 'rejected_tool') {
    await rejectCandidate(candidateId);
  }
}

export async function getFeedbackHistory(
  potId: string,
): Promise<{ action: string; count: number }[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_feedback_events')
    .select(['action', db.fn.countAll().as('count')])
    .where('pot_id', '=', potId)
    .groupBy('action')
    .execute();
  return rows.map((r) => ({ action: r.action as string, count: Number(r.count) }));
}

export async function getRecentFeedbackEvents(
  potId: string,
  limit = 50,
): Promise<AgentFeedbackEvent[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_feedback_events')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toAgentFeedbackEvent);
}

/** Returns preferred and avoided candidate types based on historical feedback. */
export async function getFeedbackTypePreferences(potId: string): Promise<{
  preferred_types: string[];
  avoid_types: string[];
  type_counts: Record<string, { positive: number; negative: number }>;
}> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('agent_feedback_events')
    .innerJoin('agent_candidates', 'agent_feedback_events.candidate_id', 'agent_candidates.id')
    .select([
      'agent_candidates.candidate_type',
      'agent_feedback_events.action',
      db.fn.countAll().as('count'),
    ])
    .where('agent_feedback_events.pot_id', '=', potId)
    .groupBy(['agent_candidates.candidate_type', 'agent_feedback_events.action'])
    .execute();

  const POSITIVE_ACTIONS = new Set(['cool', 'interested', 'opened_chat', 'opened_search']);
  const NEGATIVE_ACTIONS = new Set(['meh', 'useless', 'known']);

  const typeCounts: Record<string, { positive: number; negative: number }> = {};
  for (const row of rows) {
    const type = row.candidate_type as string;
    const action = row.action as string;
    const count = Number(row.count);
    if (!typeCounts[type]) typeCounts[type] = { positive: 0, negative: 0 };
    if (POSITIVE_ACTIONS.has(action)) typeCounts[type].positive += count;
    if (NEGATIVE_ACTIONS.has(action)) typeCounts[type].negative += count;
  }

  const preferred_types: string[] = [];
  const avoid_types: string[] = [];
  for (const [type, counts] of Object.entries(typeCounts)) {
    if (counts.positive >= counts.negative + 2) preferred_types.push(type);
    else if (counts.negative >= counts.positive + 2) avoid_types.push(type);
  }

  return { preferred_types, avoid_types, type_counts: typeCounts };
}
