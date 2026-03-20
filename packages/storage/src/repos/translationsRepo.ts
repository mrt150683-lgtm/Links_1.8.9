/**
 * Entry Translations Repository
 *
 * Stores per-entry AI translations keyed by (entry_id, target_language).
 * Upsert semantics: re-translating the same entry+language overwrites the previous result.
 *
 * Migration: 035_entry_translations.sql
 */

import { randomUUID, createHash } from 'crypto';
import { getDatabase } from '../db.js';
import type { EntryTranslation, EntryTranslationSummary, UpsertTranslationInput } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toEntryTranslation(row: any): EntryTranslation {
  return {
    id: row.id,
    entry_id: row.entry_id,
    target_language: row.target_language,
    target_language_code: row.target_language_code,
    translated_text: row.translated_text,
    model_id: row.model_id,
    chunk_count: row.chunk_count,
    source_hash: row.source_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Compute SHA-256 of the source text used for translation.
 * Stored so callers can detect stale translations if the source changes.
 */
export function hashSourceText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ── CRUD ─────────────────────────────────────────────────────────────────

/**
 * Insert or update a translation.
 * UNIQUE(entry_id, target_language) ensures at most one row per pair.
 * On conflict, updates translated_text, model_id, chunk_count, source_hash, updated_at.
 */
export async function upsertTranslation(input: UpsertTranslationInput): Promise<EntryTranslation> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('entry_translations')
    .values({
      id,
      entry_id: input.entry_id,
      target_language: input.target_language,
      target_language_code: input.target_language_code,
      translated_text: input.translated_text,
      model_id: input.model_id,
      chunk_count: input.chunk_count,
      source_hash: input.source_hash,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['entry_id', 'target_language']).doUpdateSet({
        translated_text: input.translated_text,
        model_id: input.model_id,
        chunk_count: input.chunk_count,
        source_hash: input.source_hash,
        updated_at: now,
      })
    )
    .execute();

  const row = await db
    .selectFrom('entry_translations')
    .selectAll()
    .where('entry_id', '=', input.entry_id)
    .where('target_language', '=', input.target_language)
    .executeTakeFirstOrThrow();

  return toEntryTranslation(row);
}

/**
 * Retrieve a translation by entry + language. Returns null if not found.
 */
export async function getTranslation(
  entryId: string,
  targetLanguage: string,
): Promise<EntryTranslation | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('entry_translations')
    .selectAll()
    .where('entry_id', '=', entryId)
    .where('target_language', '=', targetLanguage)
    .executeTakeFirst();

  return row ? toEntryTranslation(row) : null;
}

/**
 * List lightweight translation metadata for an entry (no translated_text).
 * Used to populate the "already translated" badges in the UI.
 */
export async function listTranslationsForEntry(entryId: string): Promise<EntryTranslationSummary[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('entry_translations')
    .select(['target_language', 'target_language_code', 'created_at', 'updated_at'])
    .where('entry_id', '=', entryId)
    .orderBy('target_language', 'asc')
    .execute();

  return rows.map((r) => ({
    target_language: r.target_language,
    target_language_code: r.target_language_code,
    created_at: r.created_at as number,
    updated_at: r.updated_at,
  }));
}
