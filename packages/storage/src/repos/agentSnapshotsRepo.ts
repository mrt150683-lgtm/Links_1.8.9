/**
 * Agent Snapshots Repository
 *
 * CRUD for:
 *   - agent_snapshots  (temp SQLite clone TTL-managed)
 *
 * Migration: 042_agent_snapshots.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { AgentSnapshot, AgentSnapshotsTable, CreateAgentSnapshotInput } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toAgentSnapshot(row: any): AgentSnapshot {
  return {
    id: row.id,
    pot_id: row.pot_id,
    run_id: row.run_id,
    scope: row.scope_json ? JSON.parse(row.scope_json) : null,
    storage_mode: row.storage_mode,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    encrypted_path: row.encrypted_path,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at as number,
    deleted_at: row.deleted_at,
  };
}

// ── Agent Snapshots ───────────────────────────────────────────────────────

export async function createAgentSnapshot(input: CreateAgentSnapshotInput): Promise<AgentSnapshot> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = input.expires_at ?? now + 2 * 3_600_000; // 2h default

  await db
    .insertInto('agent_snapshots')
    .values({
      id,
      pot_id: input.pot_id,
      run_id: input.run_id ?? null,
      scope_json: input.scope ? JSON.stringify(input.scope) : '{}',
      storage_mode: input.storage_mode ?? 'logical_slice',
      manifest_json: '{}',
      encrypted_path: input.encrypted_path ?? null,
      status: 'creating',
      expires_at: expiresAt,
      created_at: now,
      deleted_at: null,
    })
    .execute();

  const row = await db
    .selectFrom('agent_snapshots')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return toAgentSnapshot(row);
}

export async function getAgentSnapshot(id: string): Promise<AgentSnapshot | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_snapshots')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toAgentSnapshot(row) : null;
}

export async function updateAgentSnapshotStatus(
  id: string,
  status: AgentSnapshotsTable['status'],
  fields?: {
    encrypted_path?: string;
    manifest?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_snapshots')
    .set({
      status,
      encrypted_path: fields?.encrypted_path,
      manifest_json: fields?.manifest ? JSON.stringify(fields.manifest) : undefined,
    })
    .where('id', '=', id)
    .execute();
}

export async function deleteAgentSnapshot(id: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('agent_snapshots')
    .set({ status: 'deleted', deleted_at: now })
    .where('id', '=', id)
    .execute();
}

export async function listExpiredAgentSnapshots(): Promise<AgentSnapshot[]> {
  const db = getDatabase();
  const now = Date.now();
  const rows = await db
    .selectFrom('agent_snapshots')
    .selectAll()
    .where('expires_at', '<', now)
    .where('status', 'not in', ['deleted'])
    .execute();
  return rows.map(toAgentSnapshot);
}

export async function listAgentSnapshotsByPot(
  potId: string,
  limit = 10,
): Promise<AgentSnapshot[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_snapshots')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', '!=', 'deleted')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toAgentSnapshot);
}

export async function listAgentSnapshotsByRun(runId: string): Promise<AgentSnapshot[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_snapshots')
    .selectAll()
    .where('run_id', '=', runId)
    .where('status', '!=', 'deleted')
    .execute();
  return rows.map(toAgentSnapshot);
}
