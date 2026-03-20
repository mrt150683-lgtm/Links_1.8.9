import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { getDatabase } from '../db.js';
import type { AuditEvent, Database } from '../types.js';

export interface CreateAuditEventInput {
  actor: 'user' | 'system' | 'extension';
  action: string;
  pot_id?: string;
  entry_id?: string;
  metadata?: Record<string, unknown>;
  // flow correlation (031_flow_correlation)
  job_id?: string;
}

/**
 * Log an audit event
 */
export async function logAuditEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
  const db = getDatabase();
  const now = Date.now();

  const event = {
    id: randomUUID(),
    timestamp: now,
    actor: input.actor,
    action: input.action,
    pot_id: input.pot_id ?? null,
    entry_id: input.entry_id ?? null,
    metadata_json: JSON.stringify(input.metadata ?? {}),
    job_id: input.job_id ?? null,
  };

  await db.insertInto('audit_events').values(event).execute();

  return {
    ...event,
    metadata: input.metadata ?? {},
    job_id: event.job_id,
  };
}

/**
 * Get audit events for a pot
 */
export async function getAuditEventsByPot(potId: string): Promise<AuditEvent[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('audit_events')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('timestamp', 'desc')
    .execute();

  return rows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }));
}

/**
 * Get audit events for an entry
 */
export async function getAuditEventsByEntry(entryId: string): Promise<AuditEvent[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('audit_events')
    .selectAll()
    .where('entry_id', '=', entryId)
    .orderBy('timestamp', 'desc')
    .execute();

  return rows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }));
}

/**
 * Get recent audit events
 */
export async function getRecentAuditEvents(limit: number = 100): Promise<AuditEvent[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('audit_events')
    .selectAll()
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }));
}

/**
 * Phase 3: Log audit event within a transaction
 */
export async function logAuditEventInTransaction(
  trx: Kysely<Database> | Transaction<Database>,
  input: CreateAuditEventInput
): Promise<AuditEvent> {
  const now = Date.now();

  const event = {
    id: randomUUID(),
    timestamp: now,
    actor: input.actor,
    action: input.action,
    pot_id: input.pot_id ?? null,
    entry_id: input.entry_id ?? null,
    metadata_json: JSON.stringify(input.metadata ?? {}),
    job_id: input.job_id ?? null,
  };

  await trx.insertInto('audit_events').values(event).execute();

  return {
    ...event,
    metadata: input.metadata ?? {},
    job_id: event.job_id,
  };
}
