/**
 * Voice Sessions Repository
 *
 * Tracks voice session lifecycle and per-turn events.
 *
 * Migration: 034_voice_tables.sql
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db.js';
import type {
  VoiceSession,
  VoiceSessionEvent,
  CreateVoiceSessionInput,
  VoiceSessionStatus,
} from '../types.js';

// ── Mappers ───────────────────────────────────────────────────────────────

function toVoiceSession(row: any): VoiceSession {
  return {
    id: row.id,
    status: row.status,
    voice_id: row.voice_id ?? null,
    stt_engine: row.stt_engine ?? null,
    input_device: row.input_device ?? null,
    output_device: row.output_device ?? null,
    pot_id: row.pot_id ?? null,
    turn_count: row.turn_count,
    interruption_count: row.interruption_count,
    avg_stt_latency_ms: row.avg_stt_latency_ms ?? null,
    avg_tts_latency_ms: row.avg_tts_latency_ms ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at,
    stopped_at: row.stopped_at ?? null,
    updated_at: row.updated_at,
  };
}

function toVoiceSessionEvent(row: any): VoiceSessionEvent {
  return {
    id: row.id,
    session_id: row.session_id,
    event_type: row.event_type,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    latency_ms: row.latency_ms ?? null,
    created_at: row.created_at,
  };
}

// ── Session CRUD ──────────────────────────────────────────────────────────

export async function createVoiceSession(
  input: CreateVoiceSessionInput,
): Promise<VoiceSession> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('voice_sessions')
    .values({
      id,
      status: 'active',
      voice_id: input.voice_id ?? null,
      stt_engine: input.stt_engine ?? null,
      input_device: input.input_device ?? null,
      output_device: input.output_device ?? null,
      pot_id: input.pot_id ?? null,
      turn_count: 0,
      interruption_count: 0,
      avg_stt_latency_ms: null,
      avg_tts_latency_ms: null,
      error_message: null,
      started_at: now,
      stopped_at: null,
      updated_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('voice_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toVoiceSession(row);
}

export async function getVoiceSession(id: string): Promise<VoiceSession | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('voice_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toVoiceSession(row) : null;
}

export async function stopVoiceSession(
  id: string,
  opts?: { error_message?: string; status?: VoiceSessionStatus },
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const status: VoiceSessionStatus = opts?.status ?? 'stopped';

  await db
    .updateTable('voice_sessions')
    .set({
      status,
      stopped_at: now,
      updated_at: now,
      error_message: opts?.error_message ?? null,
    })
    .where('id', '=', id)
    .execute();
}

export async function incrementSessionTurnCount(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('voice_sessions')
    .set((eb) => ({
      turn_count: eb('turn_count', '+', 1),
      updated_at: Date.now(),
    }))
    .where('id', '=', id)
    .execute();
}

export async function incrementSessionInterruptionCount(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('voice_sessions')
    .set((eb) => ({
      interruption_count: eb('interruption_count', '+', 1),
      updated_at: Date.now(),
    }))
    .where('id', '=', id)
    .execute();
}

export async function countActiveSessions(): Promise<number> {
  const db = getDatabase();
  const result = await db
    .selectFrom('voice_sessions')
    .select(db.fn.count('id').as('count'))
    .where('status', '=', 'active')
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}

// ── Events ────────────────────────────────────────────────────────────────

export async function insertVoiceSessionEvent(
  sessionId: string,
  eventType: string,
  payload?: Record<string, unknown>,
  latencyMs?: number,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .insertInto('voice_session_events')
    .values({
      id: randomUUID(),
      session_id: sessionId,
      event_type: eventType,
      payload_json: payload ? JSON.stringify(payload) : null,
      latency_ms: latencyMs ?? null,
      created_at: now,
    })
    .execute();
}

export async function listVoiceSessionEvents(
  sessionId: string,
): Promise<VoiceSessionEvent[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('voice_session_events')
    .selectAll()
    .where('session_id', '=', sessionId)
    .orderBy('created_at')
    .execute();
  return rows.map(toVoiceSessionEvent);
}
