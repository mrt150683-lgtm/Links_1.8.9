/**
 * DYK Engine Repository (030_dyk)
 *
 * CRUD for dyk_items, dyk_feedback_events, dyk_notifications.
 * Includes signature computation (SHA-256) and novelty scoring (Jaccard).
 */

import { randomUUID, createHash } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  DykItem,
  DykFeedbackEvent,
  DykNotification,
  DykStatus,
  CreateDykItemInput,
  CreateDykFeedbackEventInput,
  CreateDykNotificationInput,
  DykListOptions,
  DykState,
} from '../types.js';

// ── Row mappers ──────────────────────────────────────────────────────────────

function toDykItem(row: any): DykItem {
  return {
    id: row.id,
    pot_id: row.pot_id,
    entry_id: row.entry_id,
    title: row.title,
    body: row.body,
    keywords: JSON.parse(row.keywords_json ?? '[]'),
    confidence: row.confidence,
    novelty: row.novelty,
    source_type: row.source_type,
    status: row.status,
    shown_count: row.shown_count,
    signature: row.signature,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    role_hash: row.role_hash ?? null,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
    next_eligible_at: row.next_eligible_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toDykFeedbackEvent(row: any): DykFeedbackEvent {
  return {
    id: row.id,
    dyk_id: row.dyk_id,
    pot_id: row.pot_id,
    action: row.action,
    snooze_hours: row.snooze_hours ?? null,
    engine_id: row.engine_id ?? null,
    created_at: row.created_at,
  };
}

function toDykNotification(row: any): DykNotification {
  return {
    id: row.id,
    pot_id: row.pot_id,
    dyk_id: row.dyk_id,
    title: row.title,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
    read_at: row.read_at ?? null,
  };
}

// ── Signature & Novelty ───────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 signature for a DYK item.
 * Used for deduplication — same content + source produces the same signature.
 */
export function computeDykSignature(
  title: string,
  body: string,
  keywords: string[],
  sourceType: string,
  promptVersion: string,
  roleHash: string | null | undefined,
): string {
  const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const content = [
    normalise(title) + normalise(body),
    [...keywords].sort().join(','),
    sourceType,
    promptVersion,
    roleHash ?? '',
  ].join('|');
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute Jaccard-based novelty score for a candidate set of keywords
 * against existing DYK items.
 *
 * novelty = 1 - max(Jaccard(candidate, existing)) for all existing items.
 * Returns a value in [0, 1]; higher = more novel.
 */
export function computeDykNovelty(
  candidateKeywords: string[],
  existingItems: DykItem[],
): number {
  if (existingItems.length === 0) return 1;

  const candSet = new Set(candidateKeywords.map((k) => k.toLowerCase().trim()));
  if (candSet.size === 0) return 1;

  let maxJaccard = 0;
  for (const item of existingItems) {
    const existSet = new Set(item.keywords.map((k) => k.toLowerCase().trim()));
    if (existSet.size === 0) continue;

    let intersection = 0;
    for (const k of candSet) {
      if (existSet.has(k)) intersection++;
    }
    const union = candSet.size + existSet.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > maxJaccard) maxJaccard = jaccard;
  }

  return Math.max(0, Math.min(1, 1 - maxJaccard));
}

// ── Existing items for novelty computation ────────────────────────────────────

/**
 * Load existing DYK items for a pot that have been surfaced or acted on.
 * Used as the baseline population for novelty scoring.
 */
export async function getExistingItemsForNovelty(potId: string): Promise<DykItem[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('dyk_items')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', 'in', ['shown', 'known', 'interested', 'snoozed'])
    .execute();
  return rows.map(toDykItem);
}

// ── CRUD: dyk_items ───────────────────────────────────────────────────────────

/**
 * Insert multiple DYK items. Skips items whose signature already exists for the pot.
 * Returns only the newly inserted items.
 */
export async function insertDykItems(
  items: CreateDykItemInput[],
): Promise<DykItem[]> {
  if (items.length === 0) return [];
  const db = getDatabase();
  const now = Date.now();
  const inserted: DykItem[] = [];

  for (const item of items) {
    // Check signature uniqueness
    const existing = await db
      .selectFrom('dyk_items')
      .select('id')
      .where('pot_id', '=', item.pot_id)
      .where('signature', '=', item.signature)
      .executeTakeFirst();

    if (existing) continue; // Skip duplicate

    const id = randomUUID();
    await db.insertInto('dyk_items').values({
      id,
      pot_id: item.pot_id,
      entry_id: item.entry_id,
      title: item.title,
      body: item.body,
      keywords_json: JSON.stringify(item.keywords),
      confidence: item.confidence,
      novelty: item.novelty,
      source_type: item.source_type,
      status: 'new',
      shown_count: 0,
      signature: item.signature,
      model_id: item.model_id,
      prompt_id: item.prompt_id,
      prompt_version: item.prompt_version,
      role_hash: item.role_hash ?? null,
      evidence_json: item.evidence != null ? JSON.stringify(item.evidence) : null,
      next_eligible_at: 0,
      created_at: now,
      updated_at: now,
    }).execute();

    const row = await db
      .selectFrom('dyk_items')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (row) inserted.push(toDykItem(row));
  }

  return inserted;
}

export async function listDykItems(
  potId: string,
  opts: DykListOptions = {},
): Promise<DykItem[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('dyk_items')
    .selectAll()
    .where('pot_id', '=', potId);

  if (opts.status) {
    query = query.where('status', '=', opts.status);
  }
  if (opts.min_confidence != null) {
    query = query.where('confidence', '>=', opts.min_confidence);
  }
  if (opts.min_novelty != null) {
    query = query.where('novelty', '>=', opts.min_novelty);
  }

  query = query
    .orderBy('novelty', 'desc')
    .orderBy('confidence', 'desc')
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);

  const rows = await query.execute();
  return rows.map(toDykItem);
}

export async function getDykItem(id: string): Promise<DykItem | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('dyk_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toDykItem(row) : null;
}

export async function updateDykItemStatus(
  id: string,
  status: DykStatus,
  next_eligible_at?: number,
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('dyk_items')
    .set({
      status,
      next_eligible_at: next_eligible_at ?? 0,
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function incrementDykShownCount(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('dyk_items')
    .set((eb) => ({
      shown_count: eb('shown_count', '+', 1),
      updated_at: Date.now(),
    }))
    .where('id', '=', id)
    .execute();
}

/**
 * Get the next eligible DYK item for a pot.
 * Selects the highest novelty + confidence item with status in (new, queued)
 * and next_eligible_at <= now.
 */
export async function getNextEligibleDyk(potId: string): Promise<DykItem | null> {
  const db = getDatabase();
  const now = Date.now();
  const row = await db
    .selectFrom('dyk_items')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', 'in', ['new', 'queued'])
    .where('next_eligible_at', '<=', now)
    .orderBy('novelty', 'desc')
    .orderBy('confidence', 'desc')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? toDykItem(row) : null;
}

// ── CRUD: dyk_feedback_events ─────────────────────────────────────────────────

export async function insertDykFeedbackEvent(
  input: CreateDykFeedbackEventInput,
): Promise<DykFeedbackEvent> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insertInto('dyk_feedback_events').values({
    id,
    dyk_id: input.dyk_id,
    pot_id: input.pot_id,
    action: input.action,
    snooze_hours: input.snooze_hours ?? null,
    engine_id: input.engine_id ?? null,
    created_at: now,
  }).execute();

  const row = await db
    .selectFrom('dyk_feedback_events')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toDykFeedbackEvent(row);
}

// ── CRUD: dyk_notifications ───────────────────────────────────────────────────

export async function createDykNotification(
  input: CreateDykNotificationInput,
): Promise<DykNotification> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insertInto('dyk_notifications').values({
    id,
    pot_id: input.pot_id,
    dyk_id: input.dyk_id,
    title: input.title,
    body: input.body,
    status: 'unread',
    created_at: now,
    read_at: null,
  }).execute();

  const row = await db
    .selectFrom('dyk_notifications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toDykNotification(row);
}

export async function listDykNotifications(
  potId: string,
  opts: { unread_only?: boolean; limit?: number; offset?: number } = {},
): Promise<DykNotification[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('dyk_notifications')
    .selectAll()
    .where('pot_id', '=', potId);

  if (opts.unread_only) {
    query = query.where('status', '=', 'unread');
  }

  query = query
    .orderBy('created_at', 'desc')
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);

  const rows = await query.execute();
  return rows.map(toDykNotification);
}

export async function updateDykNotificationStatus(
  id: string,
  status: 'read' | 'dismissed',
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('dyk_notifications')
    .set({
      status,
      read_at: status === 'read' ? Date.now() : null,
    })
    .where('id', '=', id)
    .execute();
}

export async function getDykNotification(id: string): Promise<DykNotification | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('dyk_notifications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toDykNotification(row) : null;
}

// ── Pot DYK State ─────────────────────────────────────────────────────────────

const DEFAULT_DYK_STATE: DykState = {
  next_dyk_due_at: 0,
  interval_hours: 4,
};

export async function getPotDykState(potId: string): Promise<DykState> {
  const db = getDatabase();
  const row = await db
    .selectFrom('pots')
    .select('dyk_state_json')
    .where('id', '=', potId)
    .executeTakeFirst();

  if (!row?.dyk_state_json) return { ...DEFAULT_DYK_STATE };

  try {
    return JSON.parse(row.dyk_state_json) as DykState;
  } catch {
    return { ...DEFAULT_DYK_STATE };
  }
}

export async function setPotDykState(potId: string, state: DykState): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('pots')
    .set({ dyk_state_json: JSON.stringify(state), updated_at: Date.now() })
    .where('id', '=', potId)
    .execute();
}
