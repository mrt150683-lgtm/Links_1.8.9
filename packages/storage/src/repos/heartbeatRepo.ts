/**
 * heartbeatRepo
 *
 * CRUD for heartbeat_snapshots and heartbeat_documents.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { CreateHeartbeatSnapshotInput, CreateHeartbeatDocumentInput } from '../types.js';

// ── Local domain types (mirrors @links/core automation-schemas) ───────────────
export interface HeartbeatSnapshot {
  id: string;
  pot_id: string;
  period_key: string;
  snapshot: Record<string, unknown>;
  summary: Record<string, unknown>;
  open_loops: unknown[];
  proposed_tasks: unknown[];
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  role_hash: string | null;
  input_fingerprint: string | null;
  created_at: number;
}

export interface HeartbeatDocument {
  id: string;
  pot_id: string;
  heartbeat_snapshot_id: string;
  format: string;
  content_text: string;
  content_sha256: string | null;
  storage_mode: 'db' | 'file' | 'both';
  file_path: string | null;
  created_at: number;
}

function rowToSnapshot(row: any): HeartbeatSnapshot {
  return {
    id: row.id,
    pot_id: row.pot_id,
    period_key: row.period_key,
    snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : {},
    summary: row.summary_json ? JSON.parse(row.summary_json) : {},
    open_loops: row.open_loops_json ? JSON.parse(row.open_loops_json) : [],
    proposed_tasks: row.proposed_tasks_json ? JSON.parse(row.proposed_tasks_json) : [],
    model_id: row.model_id ?? null,
    prompt_id: row.prompt_id ?? null,
    prompt_version: row.prompt_version ?? null,
    role_hash: row.role_hash ?? null,
    input_fingerprint: row.input_fingerprint ?? null,
    created_at: row.created_at,
  };
}

function rowToDocument(row: any): HeartbeatDocument {
  return {
    id: row.id,
    pot_id: row.pot_id,
    heartbeat_snapshot_id: row.heartbeat_snapshot_id,
    format: row.format,
    content_text: row.content_text,
    content_sha256: row.content_sha256 ?? null,
    storage_mode: row.storage_mode as HeartbeatDocument['storage_mode'],
    file_path: row.file_path ?? null,
    created_at: row.created_at,
  };
}

export async function createHeartbeatSnapshot(
  input: CreateHeartbeatSnapshotInput,
): Promise<HeartbeatSnapshot> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db
    .insertInto('heartbeat_snapshots')
    .values({
      id,
      pot_id: input.pot_id,
      period_key: input.period_key,
      snapshot_json: JSON.stringify(input.snapshot ?? {}),
      summary_json: JSON.stringify(input.summary ?? {}),
      open_loops_json: JSON.stringify(input.open_loops ?? []),
      proposed_tasks_json: JSON.stringify(input.proposed_tasks ?? []),
      model_id: input.model_id ?? null,
      prompt_id: input.prompt_id ?? null,
      prompt_version: input.prompt_version ?? null,
      role_hash: input.role_hash ?? null,
      input_fingerprint: input.input_fingerprint ?? null,
      created_at: now,
    })
    .execute();

  return (await getHeartbeatSnapshot(id))!;
}

export async function getHeartbeatSnapshot(id: string): Promise<HeartbeatSnapshot | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('heartbeat_snapshots')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToSnapshot(row) : null;
}

export async function getLatestHeartbeatSnapshot(potId: string): Promise<HeartbeatSnapshot | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('heartbeat_snapshots')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? rowToSnapshot(row) : null;
}

export async function listHeartbeatSnapshots(
  potId: string,
  limit = 20,
): Promise<HeartbeatSnapshot[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('heartbeat_snapshots')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(rowToSnapshot);
}

export async function getLastHeartbeatFingerprint(potId: string): Promise<string | null> {
  const snapshot = await getLatestHeartbeatSnapshot(potId);
  return snapshot?.input_fingerprint ?? null;
}

export async function createHeartbeatDocument(
  input: CreateHeartbeatDocumentInput,
): Promise<HeartbeatDocument> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db
    .insertInto('heartbeat_documents')
    .values({
      id,
      pot_id: input.pot_id,
      heartbeat_snapshot_id: input.heartbeat_snapshot_id,
      format: input.format ?? 'markdown',
      content_text: input.content_text,
      content_sha256: input.content_sha256 ?? null,
      storage_mode: input.storage_mode ?? 'db',
      file_path: input.file_path ?? null,
      created_at: now,
    })
    .execute();

  return (await getHeartbeatDocument(id))!;
}

export async function getHeartbeatDocument(id: string): Promise<HeartbeatDocument | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('heartbeat_documents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToDocument(row) : null;
}

export async function getLatestHeartbeatDocument(potId: string): Promise<HeartbeatDocument | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('heartbeat_documents')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? rowToDocument(row) : null;
}
