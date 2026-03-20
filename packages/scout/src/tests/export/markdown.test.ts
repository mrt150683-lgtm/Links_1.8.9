import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { BriefsDao } from '../../db/dao/briefs.js';
import { exportMarkdown } from '../../export/markdown.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `scout-export-out-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function insertMockBrief(
  db: Db,
  run_id: string,
  opts: { score?: number; status?: string } = {}
): string {
  const briefsDao = new BriefsDao(db);
  const brief = briefsDao.insert({
    run_id,
    score: opts.score ?? 0.8,
    repo_ids: ['repo1', 'repo2'],
    brief: {
      title: 'Test Collaboration Brief',
      concept: 'Two repos that work well together.',
      repos: [
        { full_name: 'example/repo1', why_it_fits: 'Provides the API layer.', integration_role: 'producer' },
        { full_name: 'example/repo2', why_it_fits: 'Consumes the API.', integration_role: 'consumer' },
      ],
      outreach_message: 'Hi! We noticed these repos could collaborate well.',
    },
    brief_md: `# Test Collaboration Brief\n\n> **Score:** 0.8000\n\n## Concept\n\nTwo repos that work well together.\n`,
    outreach_md: `> **Manual review required. This tool does not post to GitHub automatically.**\n\nHi! We noticed these repos could collaborate well.\n`,
    status: (opts.status ?? 'shortlisted') as 'shortlisted',
  });
  return brief.brief_id;
}

describe('exportMarkdown', () => {
  let db: Db;
  let dbPath: string;
  let outDir: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
    outDir = makeTempDir();
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  });

  it('returns briefs_exported=0 and creates index.md when no briefs exist', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(result.briefs_exported).toBe(0);
    const indexPath = path.join(result.outDir, 'index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it('creates run-specific output directory', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(result.outDir).toContain(`run_${orchestrator.run_id}`);
    expect(fs.existsSync(result.outDir)).toBe(true);
  });

  it('creates index.md with table of briefs', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.85 });

    const result = await exportMarkdown(db, orchestrator, { outDir });

    const indexContent = fs.readFileSync(path.join(result.outDir, 'index.md'), 'utf-8');
    expect(indexContent).toContain('Collaboration Briefs');
    expect(indexContent).toContain(orchestrator.run_id);
    expect(indexContent).toContain('Test Collaboration Brief');
    expect(indexContent).toContain('0.8500');
    expect(indexContent).toContain('shortlisted');
  });

  it('creates individual brief and outreach files', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const briefId = insertMockBrief(db, orchestrator.run_id);

    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(result.briefs_exported).toBe(1);

    const briefPath = path.join(result.outDir, 'briefs', `${briefId}.md`);
    const outreachPath = path.join(result.outDir, 'briefs', `${briefId}_outreach.md`);

    expect(fs.existsSync(briefPath)).toBe(true);
    expect(fs.existsSync(outreachPath)).toBe(true);
  });

  it('brief file contains the brief_md content', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const briefId = insertMockBrief(db, orchestrator.run_id);

    const result = await exportMarkdown(db, orchestrator, { outDir });

    const briefContent = fs.readFileSync(
      path.join(result.outDir, 'briefs', `${briefId}.md`),
      'utf-8'
    );
    expect(briefContent).toContain('Test Collaboration Brief');
    expect(briefContent).toContain('Score:');
  });

  it('outreach file contains the manual review banner', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const briefId = insertMockBrief(db, orchestrator.run_id);

    const result = await exportMarkdown(db, orchestrator, { outDir });

    const outreachContent = fs.readFileSync(
      path.join(result.outDir, 'briefs', `${briefId}_outreach.md`),
      'utf-8'
    );
    expect(outreachContent).toContain('Manual review required');
  });

  it('exports multiple briefs', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.9 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.8 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.7, status: 'rejected_by_threshold' });

    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(result.briefs_exported).toBe(3);

    const indexContent = fs.readFileSync(path.join(result.outDir, 'index.md'), 'utf-8');
    expect(indexContent).toContain('0.9000');
    expect(indexContent).toContain('0.8000');
    expect(indexContent).toContain('rejected_by_threshold');
  });

  it('logs export.markdown.completed audit event', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id);

    await exportMarkdown(db, orchestrator, { outDir });

    const event = db
      .prepare("SELECT * FROM audit_log WHERE event = 'export.markdown.completed'")
      .get();
    expect(event).not.toBeNull();
  });

  it('creates TOP_OPPORTUNITY_1.md for a single brief', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.9 });

    const result = await exportMarkdown(db, orchestrator, { outDir });

    const topPath = path.join(result.outDir, 'TOP_OPPORTUNITY_1.md');
    expect(fs.existsSync(topPath)).toBe(true);
    const content = fs.readFileSync(topPath, 'utf-8');
    expect(content).toContain('#1');
    expect(content).toContain('Test Collaboration Brief');
    expect(content).toContain('90.0% match');
  });

  it('creates TOP_OPPORTUNITY_1/2/3.md for three or more briefs', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.9 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.8 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.7 });

    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_1.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_2.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_3.md'))).toBe(true);
  });

  it('only creates as many TOP_OPPORTUNITY files as there are briefs', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.9 });
    // Only 1 brief, so TOP_OPPORTUNITY_2 and _3 should NOT exist
    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_1.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_2.md'))).toBe(false);
    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_3.md'))).toBe(false);
  });

  it('respects topOpportunities option to limit export count', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    insertMockBrief(db, orchestrator.run_id, { score: 0.9 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.8 });
    insertMockBrief(db, orchestrator.run_id, { score: 0.7 });

    // Request only 1 top opportunity
    const result = await exportMarkdown(db, orchestrator, { outDir, topOpportunities: 1 });

    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_1.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_2.md'))).toBe(false);
  });

  it('does not create any TOP_OPPORTUNITY files when there are no briefs', async () => {
    const orchestrator = createRunOrchestrator(db, {}, {});

    const result = await exportMarkdown(db, orchestrator, { outDir });

    expect(fs.existsSync(path.join(result.outDir, 'TOP_OPPORTUNITY_1.md'))).toBe(false);
  });
});
