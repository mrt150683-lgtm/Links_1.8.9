import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { pruneHttpCache, pruneAuditLog } from '../../db/dao/prune.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-prune-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

/** Insert an http_cache row with a specific fetched_at timestamp. */
function insertCacheEntry(db: Db, url: string, ageMs: number): void {
  const fetched_at = new Date(Date.now() - ageMs).toISOString();
  db.prepare(
    `INSERT INTO http_cache (cache_key, url, method, status, etag, last_modified, body_blob, fetched_at, expires_at)
     VALUES (?, ?, 'GET', 200, NULL, NULL, NULL, ?, NULL)`
  ).run(`key-${url}`, url, fetched_at);
}

/** Insert an audit_log row with a specific ts timestamp. */
function insertAuditEntry(db: Db, ageMs: number): void {
  const ts = new Date(Date.now() - ageMs).toISOString();
  db.prepare(
    `INSERT INTO audit_log (ts, level, run_id, scope, event, message, data_json)
     VALUES (?, 'info', NULL, NULL, 'test.event', 'Test message', NULL)`
  ).run(ts);
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('pruneHttpCache', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns rows_deleted=0 when no entries exist', () => {
    const result = pruneHttpCache(db, 30);
    expect(result.rows_deleted).toBe(0);
  });

  it('deletes entries older than the cutoff', () => {
    insertCacheEntry(db, 'https://old.example.com', 31 * DAY_MS); // 31 days old
    insertCacheEntry(db, 'https://older.example.com', 60 * DAY_MS); // 60 days old

    const result = pruneHttpCache(db, 30);
    expect(result.rows_deleted).toBe(2);

    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM http_cache').get() as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  it('keeps entries newer than the cutoff', () => {
    insertCacheEntry(db, 'https://recent.example.com', 1 * DAY_MS); // 1 day old — keep
    insertCacheEntry(db, 'https://old.example.com', 31 * DAY_MS);  // 31 days old — prune

    const result = pruneHttpCache(db, 30);
    expect(result.rows_deleted).toBe(1);

    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM http_cache').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);

    const kept = db
      .prepare('SELECT url FROM http_cache')
      .get() as { url: string };
    expect(kept.url).toBe('https://recent.example.com');
  });

  it('keeps all entries when none are old enough', () => {
    insertCacheEntry(db, 'https://a.example.com', 1 * DAY_MS);
    insertCacheEntry(db, 'https://b.example.com', 5 * DAY_MS);

    const result = pruneHttpCache(db, 30);
    expect(result.rows_deleted).toBe(0);
  });
});

describe('pruneAuditLog', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns rows_deleted=0 when no entries exist', () => {
    // createRunOrchestrator writes audit entries — clear them first
    db.prepare('DELETE FROM audit_log').run();
    const result = pruneAuditLog(db, 90);
    expect(result.rows_deleted).toBe(0);
  });

  it('deletes audit entries older than the cutoff', () => {
    db.prepare('DELETE FROM audit_log').run(); // clear run.created entries

    insertAuditEntry(db, 91 * DAY_MS); // 91 days old
    insertAuditEntry(db, 100 * DAY_MS); // 100 days old

    const result = pruneAuditLog(db, 90);
    expect(result.rows_deleted).toBe(2);
  });

  it('keeps recent audit entries', () => {
    db.prepare('DELETE FROM audit_log').run();

    insertAuditEntry(db, 1 * DAY_MS);   // 1 day — keep
    insertAuditEntry(db, 91 * DAY_MS);  // 91 days — prune

    const result = pruneAuditLog(db, 90);
    expect(result.rows_deleted).toBe(1);

    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM audit_log').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });

  it('does not delete entries created by createRunOrchestrator when they are recent', () => {
    // createRunOrchestrator writes audit entries with current timestamp — should survive pruning
    createRunOrchestrator(db, {}, {});

    const before = db
      .prepare('SELECT COUNT(*) as cnt FROM audit_log')
      .get() as { cnt: number };
    expect(before.cnt).toBeGreaterThan(0);

    const result = pruneAuditLog(db, 90);
    expect(result.rows_deleted).toBe(0); // all entries are recent
  });
});
