/**
 * Phase 8: Links Repository
 *
 * CRUD operations for links table with directionality handling
 * - Undirected types (same_topic, same_entity, duplicate): normalized order
 * - Directed types (supports, contradicts, references, sequence): preserve direction
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { Link, LinkEvidence } from '../types.js';

/**
 * Link types that are undirected (symmetric relationships)
 * These are stored with normalized order: src = MIN(id), dst = MAX(id)
 */
const UNDIRECTED_LINK_TYPES: Set<string> = new Set([
  'same_topic',
  'same_entity',
  'duplicate',
]);

/**
 * Input for creating a link
 */
export interface CreateLinkInput {
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  link_type: 'same_topic' | 'same_entity' | 'supports' | 'contradicts' | 'references' | 'sequence' | 'duplicate' | 'other';
  confidence: number;
  rationale: string;
  evidence: LinkEvidence[];
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
}

/**
 * Normalize entry IDs for undirected link types
 * Returns [min, max] to ensure consistent ordering
 */
function normalizeEntryIds(id1: string, id2: string): [string, string] {
  return id1 <= id2 ? [id1, id2] : [id2, id1];
}

/**
 * Insert a link with automatic normalization for undirected types
 *
 * For undirected link types (same_topic, same_entity, duplicate):
 * - Normalizes entry IDs so src = MIN(id), dst = MAX(id)
 * - Ensures uniqueness regardless of direction
 *
 * For directed types (supports, contradicts, references, sequence):
 * - Preserves direction as provided
 * - Direction matters for relationship semantics
 *
 * Uses INSERT OR IGNORE to handle duplicate links gracefully.
 *
 * @param input - Link creation input
 * @returns Created link, or null if duplicate was ignored
 */
export async function insertLink(input: CreateLinkInput): Promise<Link | null> {
  const db = getDatabase();
  const id = randomUUID();
  const created_at = Date.now();

  // Normalize entry IDs for undirected types
  const isUndirected = UNDIRECTED_LINK_TYPES.has(input.link_type);
  const [src, dst] = isUndirected
    ? normalizeEntryIds(input.src_entry_id, input.dst_entry_id)
    : [input.src_entry_id, input.dst_entry_id];

  // Serialize evidence array to JSON
  const evidence_json = JSON.stringify(input.evidence);

  try {
    await db
      .insertInto('links')
      .values({
        id,
        pot_id: input.pot_id,
        src_entry_id: src,
        dst_entry_id: dst,
        link_type: input.link_type,
        confidence: input.confidence,
        rationale: input.rationale,
        evidence_json,
        model_id: input.model_id,
        prompt_id: input.prompt_id,
        prompt_version: input.prompt_version,
        temperature: input.temperature,
        created_at,
      })
      .execute();

    return {
      id,
      pot_id: input.pot_id,
      src_entry_id: src,
      dst_entry_id: dst,
      link_type: input.link_type,
      confidence: input.confidence,
      rationale: input.rationale,
      evidence: input.evidence,
      model_id: input.model_id,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      temperature: input.temperature,
      created_at,
    };
  } catch (error) {
    // SQLite UNIQUE constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return null; // Duplicate link, silently ignore
    }
    throw error;
  }
}

/**
 * List links for a specific entry
 *
 * Returns all links where the entry is either src or dst,
 * filtered by confidence threshold.
 *
 * @param entryId - Entry ID to find links for
 * @param minConfidence - Minimum confidence threshold (default 0.0)
 * @param linkType - Optional filter by link type
 * @returns Array of links
 */
export async function listLinksForEntry(
  entryId: string,
  minConfidence: number = 0.0,
  linkType?: string
): Promise<Link[]> {
  const db = getDatabase();

  let query = db
    .selectFrom('links')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('src_entry_id', '=', entryId),
        eb('dst_entry_id', '=', entryId),
      ])
    )
    .where('confidence', '>=', minConfidence)
    .orderBy('confidence', 'desc');

  if (linkType) {
    query = query.where('link_type', '=', linkType as Link['link_type']);
  }

  const rows = await query.execute();

  return rows.map(rowToLink);
}

/**
 * List links for a pot
 *
 * Returns all links within a pot, filtered by confidence and type.
 *
 * @param potId - Pot ID
 * @param minConfidence - Minimum confidence threshold (default 0.0)
 * @param linkType - Optional filter by link type
 * @param limit - Maximum results (default 1000)
 * @returns Array of links
 */
export async function listLinksForPot(
  potId: string,
  minConfidence: number = 0.0,
  linkType?: string,
  limit: number = 1000
): Promise<Link[]> {
  const db = getDatabase();

  let query = db
    .selectFrom('links')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('confidence', '>=', minConfidence)
    .orderBy('confidence', 'desc')
    .limit(limit);

  if (linkType) {
    query = query.where('link_type', '=', linkType as Link['link_type']);
  }

  const rows = await query.execute();

  return rows.map(rowToLink);
}

/**
 * Get link by ID
 */
export async function getLinkById(linkId: string): Promise<Link | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('links')
    .selectAll()
    .where('id', '=', linkId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return rowToLink(row);
}

/**
 * Count links for an entry
 */
export async function countLinksForEntry(entryId: string, minConfidence: number = 0.0): Promise<number> {
  const db = getDatabase();

  const result = await db
    .selectFrom('links')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where((eb) =>
      eb.or([
        eb('src_entry_id', '=', entryId),
        eb('dst_entry_id', '=', entryId),
      ])
    )
    .where('confidence', '>=', minConfidence)
    .executeTakeFirst();

  return result?.count ?? 0;
}

/**
 * Count links for a pot
 */
export async function countLinksForPot(potId: string, minConfidence: number = 0.0): Promise<number> {
  const db = getDatabase();

  const result = await db
    .selectFrom('links')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('pot_id', '=', potId)
    .where('confidence', '>=', minConfidence)
    .executeTakeFirst();

  return result?.count ?? 0;
}

/**
 * Delete all links for a pot
 */
export async function deleteLinksForPot(potId: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('links')
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

/**
 * Delete a specific link by ID
 */
export async function deleteLink(linkId: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .deleteFrom('links')
    .where('id', '=', linkId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

/**
 * Convert database row to Link domain object
 */
function rowToLink(row: {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  link_type: string;
  confidence: number;
  rationale: string;
  evidence_json: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  created_at: number;
}): Link {
  let evidence: LinkEvidence[];
  try {
    evidence = JSON.parse(row.evidence_json) as LinkEvidence[];
  } catch {
    evidence = [];
  }

  return {
    id: row.id,
    pot_id: row.pot_id,
    src_entry_id: row.src_entry_id,
    dst_entry_id: row.dst_entry_id,
    link_type: row.link_type as Link['link_type'],
    confidence: row.confidence,
    rationale: row.rationale,
    evidence,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    temperature: row.temperature,
    created_at: Number(row.created_at),
  };
}
