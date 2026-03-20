import type { Db } from '../index.js';

export interface PruneResult {
  rows_deleted: number;
}

/**
 * Remove HTTP cache entries whose fetched_at is older than `days` days.
 */
export function pruneHttpCache(db: Db, days: number): PruneResult {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM http_cache WHERE fetched_at < ?').run(cutoff);
  return { rows_deleted: result.changes };
}

/**
 * Remove audit log entries whose ts is older than `days` days.
 */
export function pruneAuditLog(db: Db, days: number): PruneResult {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM audit_log WHERE ts < ?').run(cutoff);
  return { rows_deleted: result.changes };
}
