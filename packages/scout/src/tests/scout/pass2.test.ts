import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { runAnalysis } from '../../scout/analyze.js';
import {
  aggregateKeywords,
  generatePass2QueryStrings,
} from '../../scout/keyword_aggregator.js';
import { GitHubClient } from '../../github/client.js';
import { AnalysesDao } from '../../db/dao/analyses.js';
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
    `scout-pass2-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

describe('aggregateKeywords', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns empty array when no analyses exist', () => {
    const orchestrator = createRunOrchestrator(db, {}, {});
    const result = aggregateKeywords(db, orchestrator.run_id);
    expect(result).toHaveLength(0);
  });

  it('aggregates keywords from analyses and returns sorted by weight desc', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });
    await runAnalysis(db, orchestrator, {
      model: 'test-model',
      apiKey: 'test-key',
      _fetch: makeAnalysisFetch(),
      _sleep: noopSleep,
    });

    const aggregated = aggregateKeywords(db, orchestrator.run_id);

    expect(aggregated.length).toBeGreaterThan(0);

    // Verify sorted by weight desc
    for (let i = 0; i < aggregated.length - 1; i++) {
      if (aggregated[i]!.weight === aggregated[i + 1]!.weight) {
        expect(aggregated[i]!.keyword.localeCompare(aggregated[i + 1]!.keyword)).toBeLessThanOrEqual(0);
      } else {
        expect(aggregated[i]!.weight).toBeGreaterThanOrEqual(aggregated[i + 1]!.weight);
      }
    }
  });

  it('stores run-level keywords (repo_id = NULL) in DB', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });
    await runAnalysis(db, orchestrator, {
      model: 'test-model',
      apiKey: 'test-key',
      _fetch: makeAnalysisFetch(),
      _sleep: noopSleep,
    });

    aggregateKeywords(db, orchestrator.run_id);

    const runLevelKeywords = db
      .prepare('SELECT * FROM keywords WHERE run_id = ? AND repo_id IS NULL')
      .all(orchestrator.run_id);
    expect(runLevelKeywords.length).toBeGreaterThan(0);
  });

  it('is deterministic — same input produces same output', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });
    await runAnalysis(db, orchestrator, {
      model: 'test-model',
      apiKey: 'test-key',
      _fetch: makeAnalysisFetch(),
      _sleep: noopSleep,
    });

    const r1 = aggregateKeywords(db, orchestrator.run_id);
    const r2 = aggregateKeywords(db, orchestrator.run_id);

    expect(r1).toEqual(r2);
  });
});

describe('generatePass2QueryStrings', () => {
  it('returns empty array for empty input', () => {
    expect(generatePass2QueryStrings([])).toHaveLength(0);
  });

  it('prefers search_query kind first', () => {
    const aggregated = [
      { keyword: 'primary term', kind: 'primary' as const, weight: 1.0 },
      { keyword: 'my search query', kind: 'search_query' as const, weight: 0.5 },
    ];
    const queries = generatePass2QueryStrings(aggregated, 1);
    expect(queries[0]).toBe('my search query');
  });

  it('falls back to primary keywords when no search_query available', () => {
    const aggregated = [
      { keyword: 'primary term', kind: 'primary' as const, weight: 1.0 },
      { keyword: 'secondary term', kind: 'secondary' as const, weight: 0.5 },
    ];
    const queries = generatePass2QueryStrings(aggregated, 1);
    expect(queries[0]).toBe('primary term');
  });

  it('does not include secondary keywords in queries', () => {
    const aggregated = [
      { keyword: 'secondary-only', kind: 'secondary' as const, weight: 1.0 },
    ];
    const queries = generatePass2QueryStrings(aggregated, 5);
    expect(queries).not.toContain('secondary-only');
  });

  it('respects maxQueries cap', () => {
    const aggregated = Array.from({ length: 20 }, (_, i) => ({
      keyword: `query-${i}`,
      kind: 'search_query' as const,
      weight: 1.0,
    }));
    const queries = generatePass2QueryStrings(aggregated, 5);
    expect(queries).toHaveLength(5);
  });

  it('does not duplicate queries', () => {
    const aggregated = [
      { keyword: 'unique query', kind: 'search_query' as const, weight: 1.0 },
      { keyword: 'unique query', kind: 'primary' as const, weight: 0.9 },
    ];
    const queries = generatePass2QueryStrings(aggregated, 10);
    const unique = new Set(queries);
    expect(unique.size).toBe(queries.length);
  });
});

describe('pass2 deduplication', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('runAnalysis skips repos already analyzed in the same run', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
    await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });

    // First analysis
    const r1 = await runAnalysis(db, orchestrator, {
      model: 'test-model',
      apiKey: 'test-key',
      _fetch: makeAnalysisFetch(),
      _sleep: noopSleep,
    });

    // Second call — all repos already analyzed, should skip
    const r2 = await runAnalysis(db, orchestrator, {
      model: 'test-model',
      apiKey: 'test-key',
      _fetch: makeAnalysisFetch(),
      _sleep: noopSleep,
    });

    expect(r1.analyzed).toBe(3);
    expect(r2.analyzed).toBe(0); // all skipped

    const analysesDao = new AnalysesDao(db);
    const analyses = analysesDao.listByRunId(orchestrator.run_id);
    expect(analyses).toHaveLength(3); // no duplicates
  });
});
