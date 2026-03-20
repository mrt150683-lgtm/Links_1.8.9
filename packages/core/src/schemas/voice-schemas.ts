/**
 * Voice Addon v1 Schemas
 *
 * Zod schemas for all voice API inputs, outputs, and event types.
 * Migration: 034_voice_tables.sql
 */

import { z } from 'zod';

// ── Voice Settings ────────────────────────────────────────────────────────

export const VoiceSettingsSchema = z.object({
  selected_input_device: z.string().nullable().optional(),
  selected_output_device: z.string().nullable().optional(),
  selected_stt_engine: z.string().optional(),
  selected_voice_id: z.string().nullable().optional(),
  silence_timeout_ms: z.number().int().min(100).max(10000).optional(),
  vad_threshold: z.number().min(0).max(1).optional(),
  push_to_talk_enabled: z.boolean().optional(),
  manual_send_enabled: z.boolean().optional(),
  interruption_enabled: z.boolean().optional(),
  partial_transcripts_enabled: z.boolean().optional(),
  stream_tts_enabled: z.boolean().optional(),
  local_only_mode: z.boolean().optional(),
});

export type VoiceSettingsInput = z.infer<typeof VoiceSettingsSchema>;

// ── Voice Voice (TTS voice record) ───────────────────────────────────────

export const VoiceQualitySchema = z.enum(['low', 'medium', 'high', 'x_low']);
export type VoiceQuality = z.infer<typeof VoiceQualitySchema>;

export const VoiceVoiceSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  lang_code: z.string(),
  speaker_name: z.string(),
  quality: VoiceQualitySchema,
  engine_type: z.literal('piper'),
  source_path: z.string(),
  is_imported: z.boolean(),
  file_hash: z.string().nullable(),
  sample_rate: z.number().int().nullable(),
  num_speakers: z.number().int(),
  piper_version: z.string().nullable(),
  enabled: z.boolean(),
  created_at: z.number().int(),
});

export type VoiceVoiceDTO = z.infer<typeof VoiceVoiceSchema>;

// ── Session lifecycle ─────────────────────────────────────────────────────

export const StartSessionBodySchema = z.object({
  voice_id: z.string().optional(),
  stt_engine: z.string().optional(),
  input_device: z.string().optional(),
  output_device: z.string().optional(),
  pot_id: z.string().optional(),
});

export type StartSessionBody = z.infer<typeof StartSessionBodySchema>;

export const StopSessionBodySchema = z.object({
  session_id: z.string(),
  error_message: z.string().optional(),
});

export type StopSessionBody = z.infer<typeof StopSessionBodySchema>;

export const InterruptionBodySchema = z.object({
  session_id: z.string(),
});

export type InterruptionBody = z.infer<typeof InterruptionBodySchema>;

// ── Transcript ────────────────────────────────────────────────────────────

export const TranscriptCommitBodySchema = z.object({
  session_id: z.string(),
  text: z.string().min(1),
  pot_id: z.string().optional(),
  thread_id: z.string().optional(),
  latency_ms: z.number().int().optional(),
});

export type TranscriptCommitBody = z.infer<typeof TranscriptCommitBodySchema>;

// ── Import / Preview ──────────────────────────────────────────────────────

export const VoiceImportBodySchema = z.object({
  source_path: z.string(),
  display_name: z.string().optional(),
});

export type VoiceImportBody = z.infer<typeof VoiceImportBodySchema>;

export const VoicePreviewBodySchema = z.object({
  voice_id: z.string(),
  text: z.string().min(1).max(500),
});

export type VoicePreviewBody = z.infer<typeof VoicePreviewBodySchema>;

// ── Test endpoints ────────────────────────────────────────────────────────

export const TestSTTBodySchema = z.object({
  audio_base64: z.string(),
  mime_type: z.string().optional(),
});

export type TestSTTBody = z.infer<typeof TestSTTBodySchema>;

export const TestTTSBodySchema = z.object({
  text: z.string().min(1).max(500),
  voice_id: z.string().optional(),
});

export type TestTTSBody = z.infer<typeof TestTTSBodySchema>;

// ── Health ────────────────────────────────────────────────────────────────

export const VoiceHealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal('voice'),
  voices_available: z.number().int(),
  active_sessions: z.number().int(),
  settings_loaded: z.boolean(),
  time: z.string(),
});

export type VoiceHealthResponse = z.infer<typeof VoiceHealthResponseSchema>;

// ── Event types ───────────────────────────────────────────────────────────

export const VoiceEventTypeSchema = z.enum([
  'SESSION_STARTED',
  'SESSION_STOPPED',
  'VAD_SPEECH_START',
  'VAD_SPEECH_STOP',
  'SILENCE_TIMEOUT_STARTED',
  'SILENCE_TIMEOUT_COMMITTED',
  'TRANSCRIPT_PARTIAL',
  'TRANSCRIPT_FINAL',
  'LLM_REQUEST_STARTED',
  'LLM_REQUEST_COMPLETED',
  'TTS_SYNTHESIS_STARTED',
  'TTS_SYNTHESIS_COMPLETED',
  'PLAYBACK_STARTED',
  'PLAYBACK_STOPPED',
  'INTERRUPTION_DETECTED',
  'ERROR',
]);

export type VoiceEventType = z.infer<typeof VoiceEventTypeSchema>;
