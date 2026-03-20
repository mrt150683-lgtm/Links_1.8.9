import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { runAnalysis } from '../../scout/analyze.js';
import { GitHubClient } from '../../github/client.js';
import { AnalysesDao } from '../../db/dao/analyses.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Db } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GitHub fixtures
const fixtureDir = path.resolve(__dirname, '../fixtures/github');
const searchFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'search_repos_page1.json'), 'utf-8')) as object;
const readmeFixture = fs.readFileSync(path.join(fixtureDir, 'readme_raw_alpha.txt'), 'utf-8');

// OpenRouter fixture
const orFixtureDir = path.resolve(__dirname, '../fixtures/openrouter');
const validOrResponse = JSON.parse(
  fs.readFileSync(path.join(orFixtureDir, 'valid_analysis_response.json'), 'utf-8')
) as object;

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-analyze-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

function makeMockGitHubFetch(): typeof fetch {
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
              resources: { core: { limit: 5000, remaining: 4999, reset: 0, used: 1 }, search: { limit: 30, remaining: 29, reset: 0, used: 1 } },
              rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 },
            })
          ),
      } as unknown as Response);
    }
    if (url.includes('/search/repositories')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: (k: string) => (k === 'etag' ? '"search-etag"' : null) },
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

function makeValidOrFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(validOrResponse)),
    } as unknown as Response)) as typeof fetch;
}

function makeMalformedOrFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 'gen-bad',
            choices: [{ message: { role: 'assistant', content: 'NOT VALID JSON!!!' }, finish_reason: 'stop' }],
            model: 'test',
          })
        ),
    } as unknown as Response)) as typeof fetch;
}

const noopSleep = (): Promise<void> => Promise.resolve();

describe('runAnalysis (mocked OpenRouter)', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  async function runPass1AndAnalyze(orFetch: typeof fetch) {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });

    return runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: orFetch,
      _sleep: noopSleep,
    });
  }

  it('stores analysis rows for all repos on valid LLM response', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });

    const result = await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeValidOrFetch(),
      _sleep: noopSleep,
    });

    expect(result.analyzed).toBe(3);
    expect(result.failed).toBe(0);

    const dao = new AnalysesDao(db);
    const rows = dao.listByRunId(orchestrator.run_id);
    expect(rows).toHaveLength(3);
  });

  it('stores prompt_id and prompt_version on analysis rows', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'test', topN: 3 });

    await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeValidOrFetch(),
      _sleep: noopSleep,
    });

    const dao = new AnalysesDao(db);
    const rows = dao.listByRunId(orchestrator.run_id);
    for (const row of rows) {
      expect(row.prompt_id).toBe('repo_analysis');
      expect(row.prompt_version).toBe('v1');
    }
  });

  it('stores final_score matching deterministic calculation', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'test', topN: 3 });

    await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeValidOrFetch(),
      _sleep: noopSleep,
    });

    const dao = new AnalysesDao(db);
    const rows = dao.listByRunId(orchestrator.run_id);
    // fixture: scores {0.8, 0.7, 0.75}, signals {API, SDK, CLI, no risks}
    // bonus = 0.5 + 0.3 + 0.2 = 1.0
    // 0.35*0.8 + 0.25*0.7 + 0.35*0.75 + 0.05*1.0 = 0.28 + 0.175 + 0.2625 + 0.05 = 0.7675
    for (const row of rows) {
      expect(row.final_score).toBeCloseTo(0.7675, 4);
    }
  });

  it('stores input_snapshot_json with readme_sha256', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'test', topN: 3 });

    await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeValidOrFetch(),
      _sleep: noopSleep,
    });

    const dao = new AnalysesDao(db);
    const rows = dao.listByRunId(orchestrator.run_id);
    for (const row of rows) {
      const snapshot = JSON.parse(row.input_snapshot_json) as { readme_sha256: string };
      expect(snapshot.readme_sha256).toBeTruthy();
      expect(typeof snapshot.readme_sha256).toBe('string');
    }
  });

  it('stores keywords for each repo', async () => {
    const result = await runPass1AndAnalyze(makeValidOrFetch());

    expect(result.keywords_stored).toBeGreaterThan(0);

    const allKw = db.prepare('SELECT * FROM keywords').all();
    expect(allKw.length).toBeGreaterThan(0);
  });

  it('marks step as failed and logs llm.output.invalid_json when all analyses fail', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'test', topN: 3 });

    const result = await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeMalformedOrFetch(),
      _sleep: noopSleep,
    });

    expect(result.analyzed).toBe(0);
    expect(result.failed).toBe(3);

    // Audit log should have llm.output.invalid_json events
    const events = db
      .prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE event = 'llm.output.invalid_json'")
      .get() as { cnt: number };
    expect(events.cnt).toBe(3);

    // Step should be marked failed
    const failedStep = db
      .prepare("SELECT * FROM run_steps WHERE name = 'llm_repo_analysis' AND status = 'failed'")
      .get();
    expect(failedStep).not.toBeNull();
  });

  it('returns analyzed=0, failed=0 when there are no repos with READMEs', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    // Don't run pass1 — no repos in DB for this run
    const result = await runAnalysis(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-api-key',
      _fetch: makeValidOrFetch(),
      _sleep: noopSleep,
    });

    expect(result.analyzed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
