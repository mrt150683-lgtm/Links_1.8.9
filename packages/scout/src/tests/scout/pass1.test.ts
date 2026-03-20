import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { GitHubClient } from '../../github/client.js';
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

// Read fixture files
const fixtureDir = new URL('../../tests/fixtures/github', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const searchFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'search_repos_page1.json'), 'utf-8')) as {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{
    full_name: string;
    html_url: string;
    stargazers_count: number;
    forks_count: number;
    topics: string[];
    language: string;
    license: { spdx_id: string };
    pushed_at: string;
    archived: boolean;
    fork: boolean;
  }>;
};
const readmeFixture = fs.readFileSync(path.join(fixtureDir, 'readme_raw_alpha.txt'), 'utf-8');

function makeMockGitHubFetch(opts: {
  readmeMissing?: boolean;
}): typeof fetch {
  let callCount = 0;
  return ((_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof _url === 'string' ? _url : (_url instanceof URL ? _url.href : String(_url));
    callCount++;

    // Rate limit endpoint
    if (url.includes('/rate_limit')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({
          resources: { core: { limit: 5000, remaining: 4999, reset: 0, used: 1 }, search: { limit: 30, remaining: 29, reset: 0, used: 1 } },
          rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 },
        })),
      } as unknown as Response);
    }

    // Search endpoint
    if (url.includes('/search/repositories')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: (k: string) => k === 'etag' ? '"search-etag"' : null },
        text: () => Promise.resolve(JSON.stringify(searchFixture)),
      } as unknown as Response);
    }

    // README endpoint
    if (url.includes('/readme')) {
      if (opts.readmeMissing) {
        return Promise.resolve({
          status: 404,
          ok: false,
          headers: { get: () => null },
          text: () => Promise.resolve('Not Found'),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: (k: string) => k === 'etag' ? `"readme-etag-${callCount}"` : null },
        text: () => Promise.resolve(readmeFixture),
      } as unknown as Response);
    }

    // Fallback 404
    return Promise.resolve({
      status: 404,
      ok: false,
      headers: { get: () => null },
      text: () => Promise.resolve('Not Found'),
    } as unknown as Response);
  }) as typeof fetch;
}

describe('runPass1 (mocked GitHub)', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('creates 1 github_queries row (pass=1)', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({}) });

    const result = await runPass1(db, client, orchestrator, { query: 'vector database', topN: 3 });

    expect(result.query_id).toBeTruthy();

    const queryRow = db.prepare('SELECT * FROM github_queries WHERE query_id = ?').get(result.query_id) as { pass: number };
    expect(queryRow).not.toBeNull();
    expect(queryRow.pass).toBe(1);
  });

  it('stores 3 repo rows from fixture', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({}) });

    const result = await runPass1(db, client, orchestrator, { query: 'vector database', topN: 10 });

    expect(result.repos_stored).toBe(3);
    const count = db.prepare('SELECT COUNT(*) as cnt FROM repos').get() as { cnt: number };
    expect(count.cnt).toBe(3);
  });

  it('fetches 3 readmes from fixture', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({}) });

    const result = await runPass1(db, client, orchestrator, { query: 'vector database', topN: 10 });

    expect(result.readmes_fetched).toBe(3);
    const count = db.prepare('SELECT COUNT(*) as cnt FROM readmes').get() as { cnt: number };
    expect(count.cnt).toBe(3);
  });

  it('stores sha256 on readme rows', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({}) });

    await runPass1(db, client, orchestrator, { query: 'test', topN: 3 });

    const readmes = db.prepare('SELECT sha256 FROM readmes').all() as Array<{ sha256: string }>;
    for (const r of readmes) {
      expect(r.sha256).toBeTruthy();
      expect(r.sha256).toHaveLength(64); // sha256 hex
    }
  });

  it('deduplicates repos on second run with same repos', async () => {
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({}) });

    const orch1 = createRunOrchestrator(db, { query: 'test' }, {});
    await runPass1(db, client, orch1, { query: 'test', topN: 3 });

    const orch2 = createRunOrchestrator(db, { query: 'test2' }, {});
    await runPass1(db, client, orch2, { query: 'test', topN: 3 });

    // Should still only have 3 unique repos
    const count = db.prepare('SELECT COUNT(*) as cnt FROM repos').get() as { cnt: number };
    expect(count.cnt).toBe(3);
  });

  it('handles missing readme (404) gracefully', async () => {
    const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
    const client = new GitHubClient({ token: 'test', db, _fetch: makeMockGitHubFetch({ readmeMissing: true }) });

    const result = await runPass1(db, client, orchestrator, { query: 'test', topN: 3 });

    expect(result.readmes_missing).toBe(3);
    expect(result.readmes_fetched).toBe(0);

    // Repos should still be stored
    const count = db.prepare('SELECT COUNT(*) as cnt FROM repos').get() as { cnt: number };
    expect(count.cnt).toBe(3);

    // Audit log should have repo.readme.missing events
    const missing = db
      .prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE event = 'repo.readme.missing'")
      .get() as { cnt: number };
    expect(missing.cnt).toBe(3);
  });
});
