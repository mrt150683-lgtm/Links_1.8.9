/**
 * Voice Voices Repository
 *
 * Manages the indexed catalog of Piper TTS voices.
 * Voices are upserted by voiceDiscovery.ts on first call to GET /voice/voices.
 *
 * Migration: 034_voice_tables.sql
 */

import { getDatabase } from '../db.js';
import type { VoiceVoice, UpsertVoiceVoiceInput } from '../types.js';

// ── Mapper ────────────────────────────────────────────────────────────────

function toVoiceVoice(row: any): VoiceVoice {
  return {
    id: row.id,
    display_name: row.display_name,
    lang_code: row.lang_code,
    speaker_name: row.speaker_name,
    quality: row.quality,
    engine_type: row.engine_type,
    source_path: row.source_path,
    is_imported: row.is_imported === 1,
    file_hash: row.file_hash ?? null,
    sample_rate: row.sample_rate ?? null,
    num_speakers: row.num_speakers,
    piper_version: row.piper_version ?? null,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────

export async function upsertVoiceVoice(input: UpsertVoiceVoiceInput): Promise<VoiceVoice> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .insertInto('voice_voices')
    .values({
      id: input.id,
      display_name: input.display_name,
      lang_code: input.lang_code,
      speaker_name: input.speaker_name,
      quality: input.quality,
      engine_type: input.engine_type,
      source_path: input.source_path,
      is_imported: input.is_imported ? 1 : 0,
      file_hash: input.file_hash ?? null,
      sample_rate: input.sample_rate ?? null,
      num_speakers: input.num_speakers ?? 1,
      piper_version: input.piper_version ?? null,
      enabled: input.enabled !== false ? 1 : 0,
      created_at: now,
    })
    .onConflict((oc) =>
      oc.column('source_path').doUpdateSet({
        display_name: input.display_name,
        lang_code: input.lang_code,
        speaker_name: input.speaker_name,
        quality: input.quality,
        file_hash: input.file_hash ?? null,
        sample_rate: input.sample_rate ?? null,
        num_speakers: input.num_speakers ?? 1,
        piper_version: input.piper_version ?? null,
      }),
    )
    .execute();

  const row = await db
    .selectFrom('voice_voices')
    .selectAll()
    .where('source_path', '=', input.source_path)
    .executeTakeFirstOrThrow();

  return toVoiceVoice(row);
}

export async function listVoiceVoices(onlyEnabled = false): Promise<VoiceVoice[]> {
  const db = getDatabase();
  let query = db.selectFrom('voice_voices').selectAll();
  if (onlyEnabled) {
    query = query.where('enabled', '=', 1);
  }
  const rows = await query.orderBy('lang_code').orderBy('speaker_name').execute();
  return rows.map(toVoiceVoice);
}

export async function getVoiceVoiceById(id: string): Promise<VoiceVoice | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('voice_voices')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toVoiceVoice(row) : null;
}

export async function setVoiceEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('voice_voices')
    .set({ enabled: enabled ? 1 : 0 })
    .where('id', '=', id)
    .execute();
}

export async function countVoiceVoices(): Promise<number> {
  const db = getDatabase();
  const result = await db
    .selectFrom('voice_voices')
    .select(db.fn.count('id').as('count'))
    .where('enabled', '=', 1)
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}
