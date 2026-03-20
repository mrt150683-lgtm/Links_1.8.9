import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations, getLatestMigration } from '../../db/migrate.js';
import { RunsDao } from '../../db/dao/runs.js';
import { StepsDao } from '../../db/dao/steps.js';
import { AuditDao } from '../../db/dao/audit.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `scout-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb({ path: dbPath });
  return { db, dbPath };
}

describe('migrations', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('applies migrations on a fresh DB', () => {
    const result = runMigrations(db);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied[0]).toBe('0001_init.sql');
  });

  it('is idempotent — second run skips already-applied migrations', () => {
    runMigrations(db);
    const result2 = runMigrations(db);
    expect(result2.applied).toHaveLength(0);
    expect(result2.skipped.length).toBeGreaterThan(0);
  });

  it('getLatestMigration returns the last applied migration', () => {
    runMigrations(db);
    const latest = getLatestMigration(db);
    // Should return the last migration file alphabetically
    expect(latest).toBeTruthy();
    expect(latest).toMatch(/\.sql$/);
  });

  it('getLatestMigration returns null on fresh DB with no migrations', () => {
    const latest = getLatestMigration(db);
    expect(latest).toBeNull();
  });
});

describe('RunsDao', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('creates a run and reads it back', () => {
    const dao = new RunsDao(db);
    const run = dao.create({
      run_id: 'test-run-1',
      args: { query: 'vector db', top: 10 },
      config: { CS_LOG_LEVEL: 'info' },
    });

    expect(run.run_id).toBe('test-run-1');
    expect(run.args_json).toBe(JSON.stringify({ query: 'vector db', top: 10 }));
    expect(run.config_hash).toBeTruthy();

    const fetched = dao.get('test-run-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.run_id).toBe('test-run-1');
  });

  it('config_hash is deterministic for same config', () => {
    const dao = new RunsDao(db);
    const run1 = dao.create({ run_id: 'r1', args: {}, config: { a: '1', b: '2' } });
    const run2 = dao.create({ run_id: 'r2', args: {}, config: { b: '2', a: '1' } });
    expect(run1.config_hash).toBe(run2.config_hash);
  });
});

describe('StepsDao', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
    runMigrations(db);
    const runs = new RunsDao(db);
    runs.create({ run_id: 'run-step-test', args: {}, config: {} });
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('starts and finishes a step', () => {
    const dao = new StepsDao(db);
    const step = dao.start({ step_id: 's1', run_id: 'run-step-test', name: 'init_run' });

    expect(step.step_id).toBe('s1');
    expect(step.status).toBeNull();

    dao.finish({ step_id: 's1', status: 'success', started_at: step.started_at });

    const steps = dao.list('run-step-test');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('success');
    expect(steps[0]?.finished_at).toBeTruthy();

    const stats = JSON.parse(steps[0]?.stats_json ?? '{}') as { duration_ms: number };
    expect(stats.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('enforces foreign key constraint on run_id', () => {
    const dao = new StepsDao(db);
    expect(() => {
      dao.start({ step_id: 's-bad', run_id: 'nonexistent-run', name: 'test' });
    }).toThrow();
  });
});

describe('AuditDao', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
    runMigrations(db);
    new RunsDao(db).create({ run_id: 'audit-test-run', args: {}, config: {} });
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('writes and lists audit events', () => {
    const dao = new AuditDao(db);
    dao.write({ event: 'run.created', message: 'Run started', run_id: 'audit-test-run' });
    dao.write({ event: 'step.started', message: 'Step started', run_id: 'audit-test-run', scope: 'scout' });

    const rows = dao.list({ run_id: 'audit-test-run' });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.event)).toContain('run.created');
    expect(rows.map((r) => r.event)).toContain('step.started');
  });

  it('redacts secrets in data_json', () => {
    const dao = new AuditDao(db);
    dao.write({
      event: 'test.event',
      message: 'test',
      run_id: 'audit-test-run',
      data: { GITHUB_TOKEN: 'super-secret', other: 'value' },
    });

    const rows = dao.list({ event: 'test.event' });
    expect(rows).toHaveLength(1);
    const data = JSON.parse(rows[0]?.data_json ?? '{}') as Record<string, string>;
    expect(data['GITHUB_TOKEN']).toBe('***REDACTED***');
    expect(data['other']).toBe('value');
  });

  it('filters by event type', () => {
    const dao = new AuditDao(db);
    dao.write({ event: 'a.event', message: 'a', run_id: 'audit-test-run' });
    dao.write({ event: 'b.event', message: 'b', run_id: 'audit-test-run' });

    const rows = dao.list({ event: 'a.event' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toBe('a.event');
  });
});
