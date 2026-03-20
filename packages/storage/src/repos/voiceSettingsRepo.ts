/**
 * Voice Settings Repository
 *
 * Singleton settings row (id=1) seeded by migration 034.
 * getVoiceSettings() always returns a record (never 404).
 */

import { getDatabase } from '../db.js';
import type { VoiceSettings, UpdateVoiceSettingsInput } from '../types.js';

// ── Mapper ────────────────────────────────────────────────────────────────

function toVoiceSettings(row: any): VoiceSettings {
  return {
    id: row.id,
    selected_input_device: row.selected_input_device ?? null,
    selected_output_device: row.selected_output_device ?? null,
    selected_stt_engine: row.selected_stt_engine,
    selected_voice_id: row.selected_voice_id ?? null,
    silence_timeout_ms: row.silence_timeout_ms,
    vad_threshold: row.vad_threshold,
    push_to_talk_enabled: row.push_to_talk_enabled === 1,
    manual_send_enabled: row.manual_send_enabled === 1,
    interruption_enabled: row.interruption_enabled === 1,
    partial_transcripts_enabled: row.partial_transcripts_enabled === 1,
    stream_tts_enabled: row.stream_tts_enabled === 1,
    local_only_mode: row.local_only_mode === 1,
    updated_at: row.updated_at,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────

export async function getVoiceSettings(): Promise<VoiceSettings> {
  const db = getDatabase();
  const row = await db
    .selectFrom('voice_settings')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return toVoiceSettings(row);
}

export async function updateVoiceSettings(
  input: UpdateVoiceSettingsInput,
): Promise<VoiceSettings> {
  const db = getDatabase();
  const now = Date.now();

  const updates: Record<string, unknown> = { updated_at: now };

  if (input.selected_input_device !== undefined)
    updates.selected_input_device = input.selected_input_device;
  if (input.selected_output_device !== undefined)
    updates.selected_output_device = input.selected_output_device;
  if (input.selected_stt_engine !== undefined)
    updates.selected_stt_engine = input.selected_stt_engine;
  if (input.selected_voice_id !== undefined)
    updates.selected_voice_id = input.selected_voice_id;
  if (input.silence_timeout_ms !== undefined)
    updates.silence_timeout_ms = input.silence_timeout_ms;
  if (input.vad_threshold !== undefined)
    updates.vad_threshold = input.vad_threshold;
  if (input.push_to_talk_enabled !== undefined)
    updates.push_to_talk_enabled = input.push_to_talk_enabled ? 1 : 0;
  if (input.manual_send_enabled !== undefined)
    updates.manual_send_enabled = input.manual_send_enabled ? 1 : 0;
  if (input.interruption_enabled !== undefined)
    updates.interruption_enabled = input.interruption_enabled ? 1 : 0;
  if (input.partial_transcripts_enabled !== undefined)
    updates.partial_transcripts_enabled = input.partial_transcripts_enabled ? 1 : 0;
  if (input.stream_tts_enabled !== undefined)
    updates.stream_tts_enabled = input.stream_tts_enabled ? 1 : 0;
  if (input.local_only_mode !== undefined)
    updates.local_only_mode = input.local_only_mode ? 1 : 0;

  await db
    .updateTable('voice_settings')
    .set(updates as any)
    .where('id', '=', 1)
    .execute();

  return getVoiceSettings();
}
