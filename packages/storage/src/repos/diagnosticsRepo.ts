/**
 * Phase 12: Diagnostics Repository
 *
 * Query system state for health checks and diagnostics.
 */

import { getDatabase, getSqliteInstance } from '../db.js';
import { getConfig } from '@links/config';

/**
 * Get current migration version
 */
export async function getMigrationVersion(): Promise<number> {
  const db = getDatabase();

  // Check migrations table for latest id (migration version)
  const result = await db
    .selectFrom('migrations')
    .select('id')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();

  return result?.id ?? 0;
}

/**
 * Check if database connection is healthy
 */
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    const db = getDatabase();
    await db.selectFrom('migrations').select('id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get database pragmas (WAL mode, synchronous setting)
 */
export async function getDatabasePragmas(): Promise<{
  wal_mode: boolean;
  synchronous: string;
}> {
  const sqlite = getSqliteInstance();

  // Query pragma values using better-sqlite3
  const journalMode = sqlite.pragma('journal_mode', { simple: true }) as string;
  const synchronous = sqlite.pragma('synchronous', { simple: true });

  return {
    wal_mode: journalMode.toLowerCase() === 'wal',
    synchronous: synchronous?.toString() || 'unknown',
  };
}

/**
 * Get job queue statistics
 */
export async function getJobQueueStats(): Promise<{
  queued: number;
  running: number;
  failed: number;
  dead: number;
}> {
  const db = getDatabase();

  // Count jobs by status
  const results = await db
    .selectFrom('processing_jobs')
    .select(['status', db.fn.count<number>('id').as('count')])
    .groupBy('status')
    .execute();

  const stats = {
    queued: 0,
    running: 0,
    failed: 0,
    dead: 0,
  };

  for (const row of results) {
    if (row.status === 'queued') stats.queued = row.count;
    if (row.status === 'running') stats.running = row.count;
    if (row.status === 'failed') stats.failed = row.count;
    if (row.status === 'dead') stats.dead = row.count;
  }

  return stats;
}

/**
 * Get asset store statistics
 */
export async function getAssetStoreStats(): Promise<{
  blob_count: number;
  orphan_count: number;
}> {
  const db = getDatabase();

  // Count total assets
  const totalResult = await db
    .selectFrom('assets')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  const blob_count = totalResult?.count ?? 0;

  // Count orphaned assets (assets not referenced by any entry)
  const orphanResult = await db
    .selectFrom('assets')
    .select(db.fn.count<number>('assets.id').as('count'))
    .leftJoin('entries', 'entries.asset_id', 'assets.id')
    .where('entries.id', 'is', null)
    .executeTakeFirst();

  const orphan_count = orphanResult?.count ?? 0;

  return {
    blob_count,
    orphan_count,
  };
}

/**
 * Get model registry statistics
 */
export async function getModelRegistryStats(): Promise<{
  fetched_at: number | null;
  age_ms: number | null;
  model_count: number;
}> {
  const db = getDatabase();

  // Get most recent fetch timestamp
  const fetchResult = await db
    .selectFrom('ai_models')
    .select('fetched_at')
    .orderBy('fetched_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  const fetched_at = fetchResult?.fetched_at ?? null;
  const age_ms = fetched_at ? Date.now() - fetched_at : null;

  // Count models
  const countResult = await db
    .selectFrom('ai_models')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  const model_count = countResult?.count ?? 0;

  return {
    fetched_at,
    age_ms,
    model_count,
  };
}

/**
 * Get database file path
 */
export function getDatabasePath(): string {
  const config = getConfig();
  return config.DATABASE_PATH;
}
