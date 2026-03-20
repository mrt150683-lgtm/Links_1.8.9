import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { runAnalysis } from '../../scout/analyze.js';
import { replayScoring } from '../../scout/replay.js';
import { GitHubClient } from '../../github/client.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Db } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixtureDir = path.resolve(__dirname, '../fixtures/github');
const searchFixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'search_repos_page1.json'), 'utf-8')
) as object;
const readmeFixture = fs.readFileSync(path.join(fixtureDir, 'readme_raw_alpha.txt'), 'utf-8');

const orFixtureDir = path.resolve(__dirname, '../fixtures/openrouter');
const validOrResponse = JSON.parse(
  fs.readFileSync(path.join(orFixtureDir, 'valid_analysis_response.json'), 'utf-8')
) as object;

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-replay-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

function makeGitHubFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> => {
    const url = typeof _url === 'string' ? _url : _url instanceof URL ? _url.href : String(_url);
    if (url.includes('/rate_limit')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              resources: {
                core: { limit: 5000, remaining: 4999, reset: 0, used: 1 },
                search: { limit: 30, remaining: 29, reset: 0, used: 1 },
              },
              rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 },
            })
          ),
      } as unknown as Response);
    }
    if (url.includes('/search/repositories')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: (k: string) => (k === 'etag' ? '"etag"' : null) },
        text: () => Promise.resolve(JSON.stringify(searchFixture)),
      } as unknown as Response);
    }
    if (url.includes('/readme')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(readmeFixture),
      } as unknown as Response);
    }
    return Promise.resolve({
      status: 404,
      ok: false,
      headers: { get: () => null },
      text: () => Promise.resolve('Not Found'),
    } as unknown as Response);
  }) as typeof fetch;
}

function makeAnalysisFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(validOrResponse)),
    } as unknown as Response)) as typeof fetch;
}

const noopSleep = (): Promise<void> => Promise.resolve();

async function setupRunWithAnalyses(db: Db): Promise<string> {
  const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
  const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
  await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });
  await runAnalysis(db, orchestrator, {
    model: 'test-model',
    apiKey: 'test-key',
    _fetch: makeAnalysisFetch(),
    _sleep: noopSleep,
  });
  return orchestrator.run_id;
}

describe('replayScoring', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns replayed=0 for a run with no analyses', () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const result = replayScoring(db, orchestrator.run_id);
    expect(result.replayed).toBe(0);
    expect(result.changed).toBe(0);
    expect(result.diffs).toHaveLength(0);
  });

  it('replays all analyses and returns matching scores with same policy', async () => {
    const run_id = await setupRunWithAnalyses(db);
    const result = replayScoring(db, run_id);

    expect(result.replayed).toBe(3);
    expect(result.run_id).toBe(run_id);
    // Same policy → no score changes
    expect(result.changed).toBe(0);
    expect(result.unchanged).toBe(3);
    expect(result.diffs).toHaveLength(0);
  });

  it('is deterministic — same result on repeated calls', async () => {
    const run_id = await setupRunWithAnalyses(db);
    const r1 = replayScoring(db, run_id);
    const r2 = replayScoring(db, run_id);

    expect(r1.replayed).toBe(r2.replayed);
    expect(r1.changed).toBe(r2.changed);
    expect(r1.unchanged).toBe(r2.unchanged);
  });

  it('returns policy_version from the loaded policy', async () => {
    const run_id = await setupRunWithAnalyses(db);
    const result = replayScoring(db, run_id);
    expect(typeof result.policy_version).toBe('string');
    expect(result.policy_version.length).toBeGreaterThan(0);
  });

  it('does not modify the database (read-only)', async () => {
    const run_id = await setupRunWithAnalyses(db);

    const beforeScores = db
      .prepare('SELECT final_score FROM analyses WHERE run_id = ?')
      .all(run_id) as { final_score: number }[];

    replayScoring(db, run_id);

    const afterScores = db
      .prepare('SELECT final_score FROM analyses WHERE run_id = ?')
      .all(run_id) as { final_score: number }[];

    expect(beforeScores).toEqual(afterScores);
  });

  it('detects score changes when a different policy is applied', async () => {
    const run_id = await setupRunWithAnalyses(db);

    // Create a modified policy with different weights that will produce different scores
    const tmpDir = path.join(
      os.tmpdir(),
      `replay-policy-${Date.now()}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    const policyPath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        version: 'test-modified',
        weights: {
          w1_interestingness: 0.5,  // changed from 0.35
          w2_novelty: 0.1,           // changed from 0.25
          w3_collaboration_potential: 0.35,
          w4_signals_bonus: 0.05,
        },
        signals_bonus: {
          has_integration_surface: 0.5,
          has_api_or_sdk: 0.3,
          no_risk_flags: 0.2,
        },
        thresholds: {
          min_repo_score_for_brief: 0.6,
          min_collaboration_potential_for_brief: 0.65,
          min_brief_score: 0.75,
        },
      }),
      'utf-8'
    );

    const result = replayScoring(db, run_id, { policyPath });

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });

    // With modified weights, scores should differ from stored scores
    expect(result.changed).toBeGreaterThan(0);
    expect(result.diffs).toHaveLength(result.changed);
    for (const diff of result.diffs) {
      expect(diff.delta).not.toBe(0);
    }
  });
});
