/**
 * Intelligence Gen Repository (Phase intel-gen)
 *
 * CRUD operations for:
 *   - intelligence_runs
 *   - intelligence_questions
 *   - intelligence_answers
 *   - intelligence_known_questions (dedupe registry)
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  IntelligenceRun,
  IntelligenceQuestion,
  IntelligenceAnswer,
  IntelAnswerEvidence,
  CreateIntelligenceRunInput,
  CreateIntelligenceQuestionInput,
  CreateIntelligenceAnswerInput,
} from '../types.js';

// ============================================================================
// Run helpers
// ============================================================================

function rowToRun(row: {
  id: string;
  pot_id: string;
  mode: string;
  model_id: string;
  prompt_version: string;
  pot_snapshot_hash: string;
  estimated_input_tokens: number;
  context_length: number;
  status: string;
  error_message: string | null;
  custom_prompt: string | null;
  max_questions: number;
  created_at: number;
  finished_at: number | null;
}): IntelligenceRun {
  return {
    id: row.id,
    pot_id: row.pot_id,
    mode: row.mode as IntelligenceRun['mode'],
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    pot_snapshot_hash: row.pot_snapshot_hash,
    estimated_input_tokens: Number(row.estimated_input_tokens),
    context_length: Number(row.context_length),
    status: row.status as IntelligenceRun['status'],
    error_message: row.error_message,
    custom_prompt: row.custom_prompt,
    max_questions: Number(row.max_questions),
    created_at: Number(row.created_at),
    finished_at: row.finished_at != null ? Number(row.finished_at) : null,
  };
}

// ============================================================================
// Question helpers
// ============================================================================

function rowToQuestion(row: {
  id: string;
  run_id: string;
  pot_id: string;
  question_signature: string;
  question_text: string;
  entry_ids_json: string;
  category: string | null;
  rationale: string | null;
  status: string;
  created_at: number;
}): IntelligenceQuestion {
  let entry_ids: string[];
  try {
    entry_ids = JSON.parse(row.entry_ids_json) as string[];
  } catch {
    entry_ids = [];
  }

  return {
    id: row.id,
    run_id: row.run_id,
    pot_id: row.pot_id,
    question_signature: row.question_signature,
    question_text: row.question_text,
    entry_ids,
    category: row.category as IntelligenceQuestion['category'],
    rationale: row.rationale,
    status: row.status as IntelligenceQuestion['status'],
    created_at: Number(row.created_at),
  };
}

// ============================================================================
// Answer helpers
// ============================================================================

function rowToAnswer(row: {
  id: string;
  question_id: string;
  pot_id: string;
  answer_text: string;
  confidence: number;
  evidence_json: string;
  excerpt_validation: string;
  excerpt_validation_details: string | null;
  limits_text: string | null;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  token_usage_json: string | null;
  created_at: number;
}): IntelligenceAnswer {
  let evidence: IntelAnswerEvidence[];
  try {
    evidence = JSON.parse(row.evidence_json) as IntelAnswerEvidence[];
  } catch {
    evidence = [];
  }

  let token_usage: IntelligenceAnswer['token_usage'] = null;
  if (row.token_usage_json) {
    try {
      token_usage = JSON.parse(row.token_usage_json) as IntelligenceAnswer['token_usage'];
    } catch {
      token_usage = null;
    }
  }

  return {
    id: row.id,
    question_id: row.question_id,
    pot_id: row.pot_id,
    answer_text: row.answer_text,
    confidence: Number(row.confidence),
    evidence,
    excerpt_validation: row.excerpt_validation as 'pass' | 'fail',
    excerpt_validation_details: row.excerpt_validation_details,
    limits_text: row.limits_text,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    temperature: Number(row.temperature),
    token_usage,
    created_at: Number(row.created_at),
  };
}

// ============================================================================
// Runs
// ============================================================================

export async function insertIntelligenceRun(
  input: CreateIntelligenceRunInput
): Promise<IntelligenceRun> {
  const db = getDatabase();
  const id = randomUUID();
  const created_at = Date.now();

  const custom_prompt = input.custom_prompt?.trim() || null;
  const max_questions = Math.min(Math.max(input.max_questions ?? 2, 1), 20);

  await db
    .insertInto('intelligence_runs')
    .values({
      id,
      pot_id: input.pot_id,
      mode: input.mode,
      model_id: input.model_id,
      prompt_version: input.prompt_version,
      pot_snapshot_hash: input.pot_snapshot_hash,
      estimated_input_tokens: input.estimated_input_tokens,
      context_length: input.context_length,
      status: 'queued',
      error_message: null,
      custom_prompt,
      max_questions,
      created_at,
      finished_at: null,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    mode: input.mode,
    model_id: input.model_id,
    prompt_version: input.prompt_version,
    pot_snapshot_hash: input.pot_snapshot_hash,
    estimated_input_tokens: input.estimated_input_tokens,
    context_length: input.context_length,
    status: 'queued',
    error_message: null,
    custom_prompt,
    max_questions,
    created_at,
    finished_at: null,
  };
}

export async function updateIntelligenceRunStatus(
  runId: string,
  status: IntelligenceRun['status'],
  errorMessage?: string
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('intelligence_runs')
    .set({
      status,
      error_message: errorMessage ?? null,
      finished_at: status === 'done' || status === 'failed' ? Date.now() : null,
    })
    .where('id', '=', runId)
    .execute();
}

export async function getIntelligenceRunById(runId: string): Promise<IntelligenceRun | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('intelligence_runs')
    .selectAll()
    .where('id', '=', runId)
    .executeTakeFirst();
  return row ? rowToRun(row) : null;
}

export async function listIntelligenceRunsForPot(
  potId: string,
  limit = 20
): Promise<IntelligenceRun[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('intelligence_runs')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToRun);
}

// ============================================================================
// Questions
// ============================================================================

export async function insertIntelligenceQuestion(
  input: CreateIntelligenceQuestionInput
): Promise<IntelligenceQuestion> {
  const db = getDatabase();
  const id = randomUUID();
  const created_at = Date.now();
  const entry_ids_json = JSON.stringify([...input.entry_ids].sort());

  await db
    .insertInto('intelligence_questions')
    .values({
      id,
      run_id: input.run_id,
      pot_id: input.pot_id,
      question_signature: input.question_signature,
      question_text: input.question_text,
      entry_ids_json,
      category: input.category ?? null,
      rationale: input.rationale ?? null,
      status: 'queued',
      created_at,
    })
    .execute();

  return {
    id,
    run_id: input.run_id,
    pot_id: input.pot_id,
    question_signature: input.question_signature,
    question_text: input.question_text,
    entry_ids: [...input.entry_ids].sort(),
    category: input.category ?? null,
    rationale: input.rationale ?? null,
    status: 'queued',
    created_at,
  };
}

export async function updateIntelligenceQuestionStatus(
  questionId: string,
  status: IntelligenceQuestion['status']
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('intelligence_questions')
    .set({ status })
    .where('id', '=', questionId)
    .execute();
}

export async function getIntelligenceQuestionById(
  questionId: string
): Promise<IntelligenceQuestion | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('intelligence_questions')
    .selectAll()
    .where('id', '=', questionId)
    .executeTakeFirst();
  return row ? rowToQuestion(row) : null;
}

/**
 * Atomically claim one queued question for a pot and mark it running.
 * Returns the claimed question, or null if none available.
 * Uses getSqliteInstance for the atomic UPDATE+SELECT.
 */
export async function claimNextQueuedQuestion(
  potId: string
): Promise<IntelligenceQuestion | null> {
  const { getSqliteInstance } = await import('../db.js');
  const sqlite = getSqliteInstance();

  // Atomic: find a queued question for this pot and mark it running
  const row = sqlite
    .prepare(
      `UPDATE intelligence_questions
         SET status = 'running'
       WHERE id = (
         SELECT id FROM intelligence_questions
          WHERE pot_id = ? AND status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
       )
       RETURNING *`
    )
    .get(potId) as
    | {
        id: string;
        run_id: string;
        pot_id: string;
        question_signature: string;
        question_text: string;
        entry_ids_json: string;
        category: string | null;
        rationale: string | null;
        status: string;
        created_at: number;
      }
    | undefined;

  if (!row) return null;
  return rowToQuestion(row);
}

export async function listIntelligenceQuestionsForRun(
  runId: string
): Promise<IntelligenceQuestion[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('intelligence_questions')
    .selectAll()
    .where('run_id', '=', runId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(rowToQuestion);
}

export async function listIntelligenceQuestionsForPot(
  potId: string,
  limit = 100
): Promise<IntelligenceQuestion[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('intelligence_questions')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToQuestion);
}

// ============================================================================
// Answers
// ============================================================================

export async function insertIntelligenceAnswer(
  input: CreateIntelligenceAnswerInput
): Promise<IntelligenceAnswer> {
  const db = getDatabase();
  const id = randomUUID();
  const created_at = Date.now();
  const evidence_json = JSON.stringify(input.evidence);
  const token_usage_json = input.token_usage ? JSON.stringify(input.token_usage) : null;

  await db
    .insertInto('intelligence_answers')
    .values({
      id,
      question_id: input.question_id,
      pot_id: input.pot_id,
      answer_text: input.answer_text,
      confidence: input.confidence,
      evidence_json,
      excerpt_validation: input.excerpt_validation,
      excerpt_validation_details: input.excerpt_validation_details ?? null,
      limits_text: input.limits_text ?? null,
      model_id: input.model_id,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      temperature: input.temperature,
      token_usage_json,
      created_at,
    })
    .execute();

  return {
    id,
    question_id: input.question_id,
    pot_id: input.pot_id,
    answer_text: input.answer_text,
    confidence: input.confidence,
    evidence: input.evidence,
    excerpt_validation: input.excerpt_validation,
    excerpt_validation_details: input.excerpt_validation_details ?? null,
    limits_text: input.limits_text ?? null,
    model_id: input.model_id,
    prompt_id: input.prompt_id,
    prompt_version: input.prompt_version,
    temperature: input.temperature,
    token_usage: input.token_usage ?? null,
    created_at,
  };
}

export async function getIntelligenceAnswerByQuestionId(
  questionId: string
): Promise<IntelligenceAnswer | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('intelligence_answers')
    .selectAll()
    .where('question_id', '=', questionId)
    .executeTakeFirst();
  return row ? rowToAnswer(row) : null;
}

export async function getIntelligenceAnswerById(
  answerId: string
): Promise<IntelligenceAnswer | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('intelligence_answers')
    .selectAll()
    .where('id', '=', answerId)
    .executeTakeFirst();
  return row ? rowToAnswer(row) : null;
}

export async function listIntelligenceAnswersForPot(
  potId: string,
  limit = 100
): Promise<IntelligenceAnswer[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('intelligence_answers')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('confidence', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToAnswer);
}

// ============================================================================
// Known Questions (dedupe)
// ============================================================================

/**
 * Check whether a question signature has already been asked for this pot+snapshot.
 * Returns true if known (should be skipped), false if new.
 */
export async function isKnownQuestion(
  potId: string,
  potSnapshotHash: string,
  questionSignature: string
): Promise<boolean> {
  const db = getDatabase();
  const row = await db
    .selectFrom('intelligence_known_questions')
    .select('id')
    .where('pot_id', '=', potId)
    .where('pot_snapshot_hash', '=', potSnapshotHash)
    .where('question_signature', '=', questionSignature)
    .executeTakeFirst();
  return row != null;
}

/**
 * Record a question signature as known (upsert).
 * If the (pot, snapshot, signature) key already exists, increment times_seen + update last_seen.
 * If not, insert a new record.
 */
export async function upsertKnownQuestion(
  potId: string,
  potSnapshotHash: string,
  questionSignature: string,
  questionId: string
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  // Try insert first; on conflict update the seen counters.
  // Kysely doesn't support ON CONFLICT natively for all dialects, so use raw sqlite.
  // We fall back to the getSqliteInstance approach to run this atomically.
  const { getSqliteInstance } = await import('../db.js');
  const sqlite = getSqliteInstance();

  sqlite
    .prepare(
      `INSERT INTO intelligence_known_questions
         (id, pot_id, pot_snapshot_hash, question_signature, last_question_id, first_seen_at, last_seen_at, times_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(pot_id, COALESCE(pot_snapshot_hash, ''), question_signature)
       DO UPDATE SET
         last_question_id = excluded.last_question_id,
         last_seen_at     = excluded.last_seen_at,
         times_seen       = times_seen + 1`
    )
    .run(randomUUID(), potId, potSnapshotHash, questionSignature, questionId, now, now);
}

/**
 * Count known questions for a pot snapshot (for diagnostics).
 */
export async function countKnownQuestionsForSnapshot(
  potId: string,
  potSnapshotHash: string
): Promise<number> {
  const db = getDatabase();
  const result = await db
    .selectFrom('intelligence_known_questions')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('pot_id', '=', potId)
    .where('pot_snapshot_hash', '=', potSnapshotHash)
    .executeTakeFirst();
  return result?.count ?? 0;
}
