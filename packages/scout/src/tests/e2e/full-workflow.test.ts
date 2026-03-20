/**
 * E2E Test: Full workflow with real API calls (Mistral Nemo)
 *
 * Requires .env with:
 * - OPENROUTER_API_KEY
 * - GITHUB_TOKEN
 *
 * Run: pnpm test e2e/full-workflow.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { runAnalysis } from '../../scout/analyze.js';
import { generateBriefs } from '../../briefs/generator.js';
import { exportMarkdown } from '../../export/markdown.js';
import { GitHubClient } from '../../github/client.js';
import { BriefsDao } from '../../db/dao/briefs.js';
import { AnalysesDao } from '../../db/dao/analyses.js';
import { loadConfig } from '../../config/load.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

const MODEL = 'x-ai/grok-4.1-fast'; // User-requested model

describe('E2E: Full Workflow (Real APIs, Mistral Nemo)', { timeout: 120000 }, () => {
  let db: Db;
  let dbPath: string;
  let config: Record<string, unknown>;

  beforeAll(() => {
    // Load config from .env
    config = loadConfig();

    if (!config.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN not set in .env');
    }
    if (!config.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not set in .env');
    }

    // Create temp DB
    dbPath = path.join(os.tmpdir(), `e2e-test-${Date.now()}.db`);
    db = openDb({ path: dbPath });
    runMigrations(db);

    console.log(`\n✓ E2E Test Setup`);
    console.log(`  Model: ${MODEL}`);
    console.log(`  DB: ${dbPath}`);
  });

  afterAll(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('Pass 1: Search GitHub for "vector database"', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'vector database' }, {});
    const ghClient = new GitHubClient({
      token: config.GITHUB_TOKEN as string,
      db,
    });

    const result = await runPass1(db, ghClient, orchestrator, {
      query: 'vector database',
      topN: 5,
      days: 180,
      stars: 50,
    });

    console.log(`\n✓ Pass 1 Complete`);
    console.log(`  Repos found: ${result.repos_found}`);
    console.log(`  Readmes fetched: ${result.readmes_fetched}`);

    expect(result.repos_found).toBeGreaterThan(0);
    expect(result.readmes_fetched).toBeGreaterThan(0);

    // Store run_id for next steps
    (globalThis as any).__e2e_run_id = orchestrator.run_id;
  });

  it('Pass 1: Analyze repos with Mistral Nemo', async () => {
    const run_id = (globalThis as any).__e2e_run_id as string;
    const orchestrator = createRunOrchestrator(db, {}, {});
    (orchestrator as any).run_id = run_id;

    const result = await runAnalysis(db, orchestrator, {
      model: MODEL,
      apiKey: config.OPENROUTER_API_KEY as string,
    });

    console.log(`\n✓ Analysis Complete (Model: ${MODEL})`);
    console.log(`  Analyzed: ${result.analyzed}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Keywords stored: ${result.keywords_stored}`);

    expect(result.analyzed).toBeGreaterThan(0);

    // Verify analyses are stored
    const analysesDao = new AnalysesDao(db);
    const analyses = analysesDao.listByRunId(run_id);
    expect(analyses.length).toBeGreaterThan(0);

    // Verify Mistral was used
    for (const analysis of analyses) {
      expect(analysis.model).toBe(MODEL);
    }
  });

  it('Brief Generation: Group repos and generate briefs', async () => {
    const run_id = (globalThis as any).__e2e_run_id as string;
    const orchestrator = createRunOrchestrator(db, {}, {});
    (orchestrator as any).run_id = run_id;

    const result = await generateBriefs(db, orchestrator, {
      model: MODEL,
      apiKey: config.OPENROUTER_API_KEY as string,
      minBriefScore: 0.5, // Lower threshold for more briefs
    });

    console.log(`\n✓ Briefs Generated (Model: ${MODEL})`);
    console.log(`  Candidates evaluated: ${result.candidates_evaluated}`);
    console.log(`  Briefs generated: ${result.briefs_generated}`);
    console.log(`  Shortlisted: ${result.briefs_shortlisted}`);
    console.log(`  Rejected: ${result.briefs_rejected}`);
    console.log(`  Failed: ${result.failed}`);

    expect(result.briefs_generated).toBeGreaterThan(0);

    // Verify briefs are stored
    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(run_id);
    expect(briefs.length).toBeGreaterThan(0);
  });

  it('Export: Write briefs to Markdown', async () => {
    const run_id = (globalThis as any).__e2e_run_id as string;
    const orchestrator = createRunOrchestrator(db, {}, {});
    (orchestrator as any).run_id = run_id;

    const outDir = path.resolve(process.cwd(), 'out');
    const result = await exportMarkdown(db, orchestrator, { outDir });

    console.log(`\n✓ Briefs Exported`);
    console.log(`  Briefs exported: ${result.briefs_exported}`);
    console.log(`  Output dir: ${result.outDir}`);

    expect(result.briefs_exported).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(result.outDir, 'index.md'))).toBe(true);

    console.log(`\n✓ Briefs available at: ${result.outDir}`);
    console.log(`  Open: ${path.join(result.outDir, 'index.md')}`);
  });
});
