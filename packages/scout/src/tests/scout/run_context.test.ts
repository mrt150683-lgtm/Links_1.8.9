import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator, STEP_NAMES } from '../../scout/run_context.js';
import { StepsDao } from '../../db/dao/steps.js';
import { AuditDao } from '../../db/dao/audit.js';
import { runDry } from '../../scout/dry_run.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

describe('createRunOrchestrator', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('creates exactly 1 runs row', () => {
    createRunOrchestrator(db, { query: 'test' }, {}, null);
    const runs = db.prepare('SELECT COUNT(*) as cnt FROM runs').get() as { cnt: number };
    expect(runs.cnt).toBe(1);
  });

  it('writes run.created audit event', () => {
    const orch = createRunOrchestrator(db, { query: 'test' }, {}, null);
    const dao = new AuditDao(db);
    const rows = dao.list({ run_id: orch.run_id, event: 'run.created' });
    expect(rows).toHaveLength(1);
  });

  it('startStep creates run_steps row and finishStep sets status', () => {
    const orch = createRunOrchestrator(db, {}, {});
    const step = orch.startStep(STEP_NAMES.INIT_RUN);
    const stepsDao = new StepsDao(db);

    const before = stepsDao.list(orch.run_id);
    expect(before).toHaveLength(1);
    expect(before[0]?.status).toBeNull();

    step.finish('success', { test: true });

    const after = stepsDao.list(orch.run_id);
    expect(after[0]?.status).toBe('success');
    expect(after[0]?.finished_at).toBeTruthy();
  });

  it('failed step sets status=failed and writes step.failed audit event', () => {
    const orch = createRunOrchestrator(db, {}, {});
    const step = orch.startStep(STEP_NAMES.GITHUB_SEARCH_PASS1);
    step.finish('failed', { error: 'network timeout' });

    const dao = new AuditDao(db);
    const rows = dao.list({ run_id: orch.run_id, event: 'step.failed' });
    expect(rows).toHaveLength(1);
  });

  it('logAudit writes custom audit events correlated to run_id', () => {
    const orch = createRunOrchestrator(db, {}, {});
    orch.logAudit({ event: 'custom.event', message: 'hello world', data: { foo: 'bar' } });

    const dao = new AuditDao(db);
    const rows = dao.list({ run_id: orch.run_id, event: 'custom.event' });
    expect(rows).toHaveLength(1);
    const data = JSON.parse(rows[0]?.data_json ?? '{}') as Record<string, string>;
    expect(data['foo']).toBe('bar');
  });

  it('audit log does not contain secrets', () => {
    const orch = createRunOrchestrator(
      db,
      { GITHUB_TOKEN: 'secret-value' },
      { OPENROUTER_API_KEY: 'another-secret' }
    );
    orch.logAudit({
      event: 'test.secret_check',
      message: 'check redaction',
      data: { GITHUB_TOKEN: 'leaked-token' },
    });

    const allLogs = db.prepare('SELECT data_json FROM audit_log').all() as { data_json: string | null }[];
    for (const row of allLogs) {
      if (row.data_json) {
        expect(row.data_json).not.toContain('secret-value');
        expect(row.data_json).not.toContain('another-secret');
        expect(row.data_json).not.toContain('leaked-token');
      }
    }
  });
});

describe('runDry', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('creates exactly 1 run row', () => {
    runDry(db, { query: 'vector database' });
    const runs = db.prepare('SELECT COUNT(*) as cnt FROM runs').get() as { cnt: number };
    expect(runs.cnt).toBe(1);
  });

  it('creates steps with status=success', () => {
    const result = runDry(db, { query: 'vector database' });
    const steps = db
      .prepare('SELECT * FROM run_steps WHERE run_id = ?')
      .all(result.run_id) as Array<{ status: string }>;
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(s.status).toBe('success');
    }
  });

  it('writes at least 3 audit log entries', () => {
    const result = runDry(db, { query: 'vector database' });
    const count = db
      .prepare('SELECT COUNT(*) as cnt FROM audit_log WHERE run_id = ?')
      .get(result.run_id) as { cnt: number };
    expect(count.cnt).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic (no network calls)', () => {
    const r1 = runDry(db, { query: 'test' });
    const r2 = runDry(db, { query: 'test' });
    // Both runs should succeed
    expect(r1.steps).toEqual(r2.steps);
    expect(r1.repos_found).toBe(r2.repos_found);
    // Run IDs are different (UUIDs)
    expect(r1.run_id).not.toBe(r2.run_id);
  });

  it('repos_found matches fixture count (3 items)', () => {
    const result = runDry(db, { query: 'anything' });
    // Our fixture has 3 repos
    expect(result.repos_found).toBe(3);
  });
});
