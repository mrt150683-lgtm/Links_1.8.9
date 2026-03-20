/**
 * Phase 8: Link Candidates Repository
 *
 * CRUD operations for link_candidates table
 * Manages candidate pairs for potential relationships between entries
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { LinkCandidate } from '../types.js';

/**
 * Input for creating a link candidate
 */
export interface CreateLinkCandidateInput {
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  reason: string;
  score: number;
}

/**
 * Normalize entry IDs for undirected candidate pairs
 * Always returns [min, max] to ensure consistent ordering
 */
function normalizeEntryIds(id1: string, id2: string): [string, string] {
  return id1 <= id2 ? [id1, id2] : [id2, id1];
}

/**
 * Insert a link candidate (with automatic deduplication)
 *
 * Uses INSERT OR IGNORE to handle duplicate candidates gracefully.
 * Entry IDs are normalized (src=min, dst=max) to prevent duplicates
 * regardless of direction.
 *
 * @param input - Candidate creation input
 * @returns Created candidate, or null if duplicate was ignored
 */
export async function insertLinkCandidate(
  input: CreateLinkCandidateInput
): Promise<LinkCandidate | null> {
  const db = getDatabase();
  const id = randomUUID();
  const created_at = Date.now();

  // Normalize entry IDs to prevent directional duplicates
  const [src, dst] = normalizeEntryIds(input.src_entry_id, input.dst_entry_id);

  try {
    await db
      .insertInto('link_candidates')
      .values({
        id,
        pot_id: input.pot_id,
        src_entry_id: src,
        dst_entry_id: dst,
        reason: input.reason,
        score: input.score,
        status: 'new',
        created_at,
      })
      .execute();

    return {
      id,
      pot_id: input.pot_id,
      src_entry_id: src,
      dst_entry_id: dst,
      reason: input.reason,
      score: input.score,
      status: 'new',
      created_at,
    };
  } catch (error) {
    // SQLite UNIQUE constraint violation (code 19)
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return null; // Duplicate candidate, silently ignore
    }
    throw error;
  }
}

/**
 * Batch insert multiple link candidates
 *
 * Returns count of successfully inserted candidates
 * (duplicates are silently ignored)
 */
export async function insertLinkCandidatesBatch(
  inputs: CreateLinkCandidateInput[]
): Promise<number> {
  let insertedCount = 0;

  for (const input of inputs) {
    const result = await insertLinkCandidate(input);
    if (result) {
      insertedCount++;
    }
  }

  return insertedCount;
}

/**
 * List new candidates for processing
 *
 * Returns unprocessed candidates sorted by score (highest first)
 *
 * @param potId - Filter by pot ID (optional)
 * @param limit - Maximum number of candidates to return
 * @returns Array of candidates with status='new'
 */
export async function listNewCandidates(
  potId?: string,
  limit: number = 100
): Promise<LinkCandidate[]> {
  const db = getDatabase();

  let query = db
    .selectFrom('link_candidates')
    .selectAll()
    .where('status', '=', 'new')
    .orderBy('score', 'desc')
    .limit(limit);

  if (potId) {
    query = query.where('pot_id', '=', potId);
  }

  const rows = await query.execute();

  return rows.map((row) => ({
    id: row.id,
    pot_id: row.pot_id,
    src_entry_id: row.src_entry_id,
    dst_entry_id: row.dst_entry_id,
    reason: row.reason,
    score: row.score,
    status: row.status,
    created_at: Number(row.created_at),
  }));
}

/**
 * Mark a candidate as processed
 */
export async function markCandidateProcessed(candidateId: string): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('link_candidates')
    .set({ status: 'processed' })
    .where('id', '=', candidateId)
    .execute();
}

/**
 * Atomically claim a candidate for processing
 *
 * Uses conditional update to prevent race conditions when multiple workers
 * are running. Returns true if claim succeeded (status was 'new'), false
 * if another worker already claimed or processed it.
 */
export async function claimCandidate(candidateId: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .updateTable('link_candidates')
    .set({ status: 'processing' })
    .where('id', '=', candidateId)
    .where('status', '=', 'new')
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
}

/**
 * Mark a candidate as skipped
 */
export async function markCandidateSkipped(candidateId: string): Promise<void> {
  const db = getDatabase();

  await db
    .updateTable('link_candidates')
    .set({ status: 'skipped' })
    .where('id', '=', candidateId)
    .execute();
}

/**
 * Get candidate by ID
 */
export async function getCandidateById(candidateId: string): Promise<LinkCandidate | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('link_candidates')
    .selectAll()
    .where('id', '=', candidateId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    pot_id: row.pot_id,
    src_entry_id: row.src_entry_id,
    dst_entry_id: row.dst_entry_id,
    reason: row.reason,
    score: row.score,
    status: row.status,
    created_at: Number(row.created_at),
  };
}

/**
 * Count candidates by status
 */
export async function countCandidatesByStatus(
  potId: string,
  status: 'new' | 'processed' | 'skipped'
): Promise<number> {
  const db = getDatabase();

  const result = await db
    .selectFrom('link_candidates')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('pot_id', '=', potId)
    .where('status', '=', status)
    .executeTakeFirst();

  return result?.count ?? 0;
}

/**
 * Delete all candidates for a pot
 * (Used when pot is deleted via CASCADE or for testing cleanup)
 */
export async function deleteCandidatesForPot(potId: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('link_candidates')
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}
