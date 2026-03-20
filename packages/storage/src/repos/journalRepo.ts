/**
 * Journal Repository
 * Journal Module: daily/weekly/monthly/quarterly/yearly notes
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import { logAuditEvent } from './auditRepo.js';
import type { JournalEntry, CreateJournalEntryInput } from '../types.js';

// ---------------------------------------------------------------------------
// Private mapper
// ---------------------------------------------------------------------------

function mapRow(row: {
  id: string;
  kind: string;
  scope_type: string;
  scope_id: string | null;
  period_start_ymd: string;
  period_end_ymd: string;
  timezone: string;
  created_at: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  input_fingerprint: string;
  content_json: string;
  citations_json: string;
}): JournalEntry {
  return {
    id: row.id,
    kind: row.kind as JournalEntry['kind'],
    scope_type: row.scope_type as JournalEntry['scope_type'],
    scope_id: row.scope_id,
    period_start_ymd: row.period_start_ymd,
    period_end_ymd: row.period_end_ymd,
    timezone: row.timezone,
    created_at: row.created_at,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    input_fingerprint: row.input_fingerprint,
    content: JSON.parse(row.content_json),
    citations: JSON.parse(row.citations_json),
  };
}

// ---------------------------------------------------------------------------
// Upsert (two-level idempotency)
// ---------------------------------------------------------------------------

/**
 * Upsert a journal entry.
 *
 * Idempotency levels:
 * 1. If entry with same (kind, scope, period, prompt) exists AND fingerprint matches → skip (no-op).
 * 2. If entry exists but fingerprint differs → overwrite content/provenance (new run).
 * 3. If no entry exists → insert.
 *
 * The UNIQUE INDEX in the DB is the safety net against race conditions.
 *
 * @returns The resulting JournalEntry and whether it was inserted/updated.
 */
export async function upsertJournalEntry(
  input: CreateJournalEntryInput,
): Promise<{ entry: JournalEntry; skipped: boolean }> {
  const db = getDatabase();
  const now = Date.now();

  const scope_id = input.scope_id ?? null;

  // 1. Check for existing entry with same (kind, scope_type, scope_id, period_start_ymd, prompt_id, prompt_version)
  const existing = await db
    .selectFrom('journal_entries')
    .selectAll()
    .where('kind', '=', input.kind)
    .where('scope_type', '=', input.scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any)
    .where('period_start_ymd', '=', input.period_start_ymd)
    .where('prompt_id', '=', input.prompt_id)
    .where('prompt_version', '=', input.prompt_version)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (existing) {
    // Level 1: fingerprint unchanged → skip
    if (existing.input_fingerprint === input.input_fingerprint) {
      return { entry: mapRow(existing), skipped: true };
    }

    // Level 2: fingerprint changed → update
    await db
      .updateTable('journal_entries')
      .set({
        period_end_ymd: input.period_end_ymd,
        timezone: input.timezone,
        model_id: input.model_id,
        temperature: input.temperature,
        max_tokens: input.max_tokens ?? null,
        input_fingerprint: input.input_fingerprint,
        content_json: JSON.stringify(input.content),
        citations_json: JSON.stringify(input.citations),
      })
      .where('id', '=', existing.id)
      .execute();

    await logAuditEvent({
      actor: 'system',
      action: 'journal_entry_updated',
      pot_id: input.scope_type === 'pot' ? scope_id ?? undefined : undefined,
      metadata: {
        journal_id: existing.id,
        kind: input.kind,
        scope_type: input.scope_type,
        scope_id,
        period_start_ymd: input.period_start_ymd,
        prompt_id: input.prompt_id,
        prompt_version: input.prompt_version,
        model_id: input.model_id,
      },
    });

    const updated = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', existing.id)
      .executeTakeFirstOrThrow();

    return { entry: mapRow(updated), skipped: false };
  }

  // Level 3: Insert new entry
  const id = randomUUID();

  await db
    .insertInto('journal_entries')
    .values({
      id,
      kind: input.kind,
      scope_type: input.scope_type,
      scope_id,
      period_start_ymd: input.period_start_ymd,
      period_end_ymd: input.period_end_ymd,
      timezone: input.timezone,
      created_at: now,
      model_id: input.model_id,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      temperature: input.temperature,
      max_tokens: input.max_tokens ?? null,
      input_fingerprint: input.input_fingerprint,
      content_json: JSON.stringify(input.content),
      citations_json: JSON.stringify(input.citations),
    })
    .execute();

  await logAuditEvent({
    actor: 'system',
    action: 'journal_entry_created',
    pot_id: input.scope_type === 'pot' ? scope_id ?? undefined : undefined,
    metadata: {
      journal_id: id,
      kind: input.kind,
      scope_type: input.scope_type,
      scope_id,
      period_start_ymd: input.period_start_ymd,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      model_id: input.model_id,
    },
  });

  const inserted = await db
    .selectFrom('journal_entries')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return { entry: mapRow(inserted), skipped: false };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get the latest journal entry matching (kind, scope_type, scope_id, period_start_ymd).
 */
export async function getJournalEntry(params: {
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  scope_type: 'pot' | 'global';
  scope_id?: string | null;
  period_start_ymd: string;
}): Promise<JournalEntry | null> {
  const db = getDatabase();
  const scope_id = params.scope_id ?? null;

  const row = await db
    .selectFrom('journal_entries')
    .selectAll()
    .where('kind', '=', params.kind)
    .where('scope_type', '=', params.scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any)
    .where('period_start_ymd', '=', params.period_start_ymd)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? mapRow(row) : null;
}

/**
 * Get a journal entry by its ID.
 */
export async function getJournalEntryById(id: string): Promise<JournalEntry | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('journal_entries')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapRow(row) : null;
}

/**
 * List journal entries with optional filters.
 */
export async function listJournalEntries(params: {
  kind?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  scope_type: 'pot' | 'global';
  scope_id?: string | null;
  from?: string; // period_start_ymd >= from
  to?: string;   // period_start_ymd <= to
  limit?: number;
}): Promise<JournalEntry[]> {
  const db = getDatabase();
  const scope_id = params.scope_id ?? null;

  let query = db
    .selectFrom('journal_entries')
    .selectAll()
    .where('scope_type', '=', params.scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any);

  if (params.kind) {
    query = query.where('kind', '=', params.kind);
  }
  if (params.from) {
    query = query.where('period_start_ymd', '>=', params.from);
  }
  if (params.to) {
    query = query.where('period_start_ymd', '<=', params.to);
  }

  query = query.orderBy('period_start_ymd', 'desc').orderBy('created_at', 'desc');

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const rows = await query.execute();
  return rows.map(mapRow);
}

/**
 * Check if a journal entry already exists with a specific fingerprint.
 * Used for quick idempotency checks before fetching full entry.
 */
export async function journalEntryExistsByFingerprint(
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  scope_type: 'pot' | 'global',
  scope_id: string | null,
  period_start_ymd: string,
  fingerprint: string,
): Promise<boolean> {
  const db = getDatabase();

  const row = await db
    .selectFrom('journal_entries')
    .select('id')
    .where('kind', '=', kind)
    .where('scope_type', '=', scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any)
    .where('period_start_ymd', '=', period_start_ymd)
    .where('input_fingerprint', '=', fingerprint)
    .executeTakeFirst();

  return row !== undefined;
}

/**
 * List child journal entries for a rollup.
 * Used by weekly (→daily), monthly (→weekly), quarterly (→monthly), yearly (→quarterly).
 */
export async function listChildJournalEntries(params: {
  child_kind: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  scope_type: 'pot' | 'global';
  scope_id?: string | null;
  period_start_ymd: string; // inclusive
  period_end_ymd: string;   // inclusive
}): Promise<JournalEntry[]> {
  const db = getDatabase();
  const scope_id = params.scope_id ?? null;

  const rows = await db
    .selectFrom('journal_entries')
    .selectAll()
    .where('kind', '=', params.child_kind)
    .where('scope_type', '=', params.scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any)
    .where('period_start_ymd', '>=', params.period_start_ymd)
    .where('period_start_ymd', '<=', params.period_end_ymd)
    .orderBy('period_start_ymd', 'asc')
    .execute();

  // Deduplicate: keep latest (by created_at) per period_start_ymd
  const seen = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const existing = seen.get(row.period_start_ymd);
    if (!existing || row.created_at > existing.created_at) {
      seen.set(row.period_start_ymd, row);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => a.period_start_ymd.localeCompare(b.period_start_ymd))
    .map(mapRow);
}
