import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { createRunOrchestrator } from '../../scout/run_context.js';
import { runPass1 } from '../../scout/pass1.js';
import { runAnalysis } from '../../scout/analyze.js';
import { generateBriefs } from '../../briefs/generator.js';
import { GitHubClient } from '../../github/client.js';
import { BriefsDao } from '../../db/dao/briefs.js';
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
const validAnalysisResponse = JSON.parse(
  fs.readFileSync(path.join(orFixtureDir, 'valid_analysis_response.json'), 'utf-8')
) as object;
const validBriefResponse = JSON.parse(
  fs.readFileSync(path.join(orFixtureDir, 'valid_brief_response.json'), 'utf-8')
) as object;

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-generator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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
      text: () => Promise.resolve(JSON.stringify(validAnalysisResponse)),
    } as unknown as Response)) as typeof fetch;
}

function makeBriefFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(validBriefResponse)),
    } as unknown as Response)) as typeof fetch;
}

function makeMalformedBriefFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 'gen-bad',
            choices: [
              {
                message: { role: 'assistant', content: 'NOT VALID JSON!!!' },
                finish_reason: 'stop',
              },
            ],
            model: 'test',
          })
        ),
    } as unknown as Response)) as typeof fetch;
}

const noopSleep = (): Promise<void> => Promise.resolve();

async function setupDbWithAnalyses(db: Db): Promise<ReturnType<typeof createRunOrchestrator>> {
  const orchestrator = createRunOrchestrator(db, { query: 'test' }, {});
  const ghClient = new GitHubClient({ token: 'test', db, _fetch: makeGitHubFetch() });
  await runPass1(db, ghClient, orchestrator, { query: 'vector database', topN: 3 });
  await runAnalysis(db, orchestrator, {
    model: 'anthropic/claude-3-5-haiku-20241022',
    apiKey: 'test-key',
    _fetch: makeAnalysisFetch(),
    _sleep: noopSleep,
  });
  return orchestrator;
}

describe('generateBriefs', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('generates briefs and stores them in DB', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    expect(result.briefs_generated).toBeGreaterThan(0);
    expect(result.candidates_evaluated).toBeGreaterThan(0);

    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(orchestrator.run_id);
    expect(briefs).toHaveLength(result.briefs_generated);
  });

  it('marks briefs as rejected_by_threshold when score is below default (0.75)', async () => {
    // With 3 repos having same integration_surface but different topics/languages,
    // brief_score ≈ 0.647 < 0.75, so all are rejected
    const orchestrator = await setupDbWithAnalyses(db);

    await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(orchestrator.run_id);
    for (const brief of briefs) {
      expect(brief.status).toBe('rejected_by_threshold');
    }
  });

  it('marks briefs as shortlisted when minBriefScore is lowered', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      minBriefScore: 0.5,
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    expect(result.briefs_shortlisted).toBeGreaterThan(0);

    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(orchestrator.run_id);
    const shortlisted = briefs.filter((b) => b.status === 'shortlisted');
    expect(shortlisted.length).toBeGreaterThan(0);
  });

  it('stored brief_md contains title and score header', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      minBriefScore: 0,
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(orchestrator.run_id);
    expect(briefs.length).toBeGreaterThan(0);
    for (const brief of briefs) {
      expect(brief.brief_md).toContain('# ');
      expect(brief.brief_md).toContain('Score:');
    }
  });

  it('stored outreach_md contains manual review banner', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      minBriefScore: 0,
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(orchestrator.run_id);
    for (const brief of briefs) {
      expect(brief.outreach_md).toContain('Manual review required');
    }
  });

  it('increments failed counter and logs audit on invalid LLM output', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeMalformedBriefFetch(),
      _sleep: noopSleep,
    });

    expect(result.failed).toBeGreaterThan(0);
    expect(result.briefs_generated).toBe(0);

    const events = db
      .prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE event = 'llm.output.invalid_json'")
      .get() as { cnt: number };
    expect(events.cnt).toBeGreaterThan(0);
  });

  it('respects maxBriefs cap', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      maxBriefs: 1,
      minBriefScore: 0,
      overlapThreshold: 1.1, // disable filter: fixture repos share identical analysis output
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    expect(result.briefs_generated).toBe(1);
  });

  it('overlap filter: rejects all pairs when threshold is very low (fixture repos are identical)', async () => {
    // The fixture analysis response is identical for all repos → functional_overlap = 1.0.
    // With a threshold of 0.0, every pair is above the threshold and no interop tokens exist
    // in the fixture → all pairs are rejected, 0 briefs generated.
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      minBriefScore: 0,
      overlapThreshold: 0.0, // everything above 0 is "competitor"
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    // All pairs filtered → 0 briefs, candidates_evaluated = 0
    expect(result.briefs_generated).toBe(0);
    expect(result.pairs_rejected_overlap).toBeGreaterThan(0);

    // Audit events should be logged for each rejected pair
    const events = db
      .prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE event = 'briefs.pair_rejected_overlap'")
      .get() as { cnt: number };
    expect(events.cnt).toBeGreaterThan(0);
  });

  it('overlap filter: result includes pairs_rejected_overlap and pairs_allowed_exception fields', async () => {
    const orchestrator = await setupDbWithAnalyses(db);

    const result = await generateBriefs(db, orchestrator, {
      model: 'anthropic/claude-3-5-haiku-20241022',
      apiKey: 'test-key',
      minBriefScore: 0,
      overlapThreshold: 1.1,
      _fetch: makeBriefFetch(),
      _sleep: noopSleep,
    });

    expect(typeof result.pairs_rejected_overlap).toBe('number');
    expect(typeof result.pairs_allowed_exception).toBe('number');
    expect(result.pairs_rejected_overlap).toBeGreaterThanOrEqual(0);
    expect(result.pairs_allowed_exception).toBeGreaterThanOrEqual(0);
  });
});
