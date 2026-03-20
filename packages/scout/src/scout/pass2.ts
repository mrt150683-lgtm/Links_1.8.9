import { randomUUID } from 'crypto';
import type { Db } from '../db/index.js';
import type { RunOrchestrator } from './run_context.js';
import { STEP_NAMES } from './run_context.js';
import type { GitHubClient } from '../github/client.js';
import { searchRepos, getReadmeRaw, type GitHubRepo } from '../github/api.js';
import { buildSearchQuery } from '../github/query_builder.js';
import { ReposDao, ReadmesDao, GithubQueriesDao } from '../db/dao/repos.js';
import { AnalysesDao } from '../db/dao/analyses.js';
import { AuditDao } from '../db/dao/audit.js';
import { runAnalysis } from './analyze.js';
import { aggregateKeywords, generatePass2QueryStrings } from './keyword_aggregator.js';
import { logger } from '../logging/logger.js';

export interface Pass2Options {
  /** Top repos to use for keyword aggregation (default 20). */
  topK?: number;
  /** Max GitHub search queries to execute (default 10). Hard cap. */
  maxQueries?: number;
  /** Min stars threshold for pass 2 searches (default 15). */
  pass2Stars?: number;
  /** Max stars threshold for pass 2 searches — excludes overly popular repos. */
  pass2MaxStars?: number;
  /** Max repos per query (default 20). */
  topNPerQuery?: number;
  /** Hard cap on total new repos to store (default 200). */
  maxNewReposTotal?: number;
  /** Hard cap on total new LLM analyses (default 200). */
  maxLLMAnalysesTotal?: number;
  /** LLM model name for analysis. */
  model: string;
  /** OpenRouter API key. */
  apiKey: string;
  /** Injected fetch for OpenRouter (for testing). */
  _fetch?: typeof fetch;
  /** Injected sleep for backoff (for testing). */
  _sleep?: (ms: number) => Promise<void>;
  /** Path to custom scoring policy JSON. */
  policyPath?: string;
}

export interface Pass2Result {
  keywords_aggregated: number;
  queries_run: number;
  repos_discovered: number;
  readmes_fetched: number;
  analyses_run: number;
  capped: boolean;
  cap_reason?: string;
}

export async function runPass2(
  db: Db,
  githubClient: GitHubClient,
  orchestrator: RunOrchestrator,
  opts: Pass2Options
): Promise<Pass2Result> {
  const maxQueries = opts.maxQueries ?? 10;
  const pass2Stars = opts.pass2Stars ?? 15;
  const topNPerQuery = opts.topNPerQuery ?? 20;
  const maxNewReposTotal = opts.maxNewReposTotal ?? 200;

  const reposDao = new ReposDao(db);
  const readmesDao = new ReadmesDao(db);
  const queriesDao = new GithubQueriesDao(db);
  const analysesDao = new AnalysesDao(db);
  const auditDao = new AuditDao(db);

  let capped = false;
  let cap_reason: string | undefined;

  // ── Step 1: Keyword Aggregation ──────────────────────────────────────────
  const kwStep = orchestrator.startStep(STEP_NAMES.KEYWORD_AGGREGATE);
  const aggregated = aggregateKeywords(db, orchestrator.run_id, opts.topK ?? 20);

  const allQueryStrings = generatePass2QueryStrings(aggregated, 100); // generate all, cap below
  const cappedQueryStrings = allQueryStrings.slice(0, maxQueries);

  if (allQueryStrings.length > maxQueries) {
    capped = true;
    cap_reason = `queries capped at ${maxQueries} (${allQueryStrings.length} generated)`;
    auditDao.write({
      event: 'pass2.queries.capped',
      message: `Query budget capped: ${allQueryStrings.length} generated, ${maxQueries} will run`,
      run_id: orchestrator.run_id,
      scope: STEP_NAMES.KEYWORD_AGGREGATE,
      data: { generated: allQueryStrings.length, capped_at: maxQueries },
    });
    logger.info(
      { run_id: orchestrator.run_id, module: 'scout.pass2' },
      `Query budget capped at ${maxQueries} (${allQueryStrings.length} generated)`
    );
  }

  kwStep.finish('success', {
    keywords_aggregated: aggregated.length,
    queries_will_run: cappedQueryStrings.length,
    capped,
  });

  // ── Step 2: Pass 2 Searches ───────────────────────────────────────────────
  let repos_discovered = 0;
  let readmes_fetched = 0;
  let queries_run = 0;

  for (const queryString of cappedQueryStrings) {
    // Hard cap on total new repos
    if (repos_discovered >= maxNewReposTotal) {
      capped = true;
      cap_reason = `new repos capped at ${maxNewReposTotal}`;
      auditDao.write({
        event: 'pass2.repos.capped',
        message: `New repo budget hit: ${repos_discovered} repos stored`,
        run_id: orchestrator.run_id,
        scope: STEP_NAMES.GITHUB_SEARCH_PASS2,
        data: { capped_at: maxNewReposTotal },
      });
      break;
    }

    const searchStep = orchestrator.startStep(STEP_NAMES.GITHUB_SEARCH_PASS2);
    const builtQuery = buildSearchQuery({
      query: queryString,
      stars: pass2Stars,
      maxStars: opts.pass2MaxStars,
      includeForks: false,
    });

    const query_id = randomUUID();
    queriesDao.create({
      query_id,
      run_id: orchestrator.run_id,
      pass: 2,
      query_string: builtQuery.q,
      params: { ...builtQuery.params, pass2Stars, queryString },
    });

    let searchItems: GitHubRepo[] = [];
    try {
      const result = await searchRepos(githubClient, {
        q: builtQuery.q,
        per_page: Math.min(topNPerQuery, 30),
        page: 1,
        sort: 'stars',
        order: 'desc',
      });
      searchItems = result.items.slice(0, topNPerQuery);
      queries_run++;

      auditDao.write({
        event: 'github.search.completed',
        message: `Pass 2 search returned ${searchItems.length} repos`,
        run_id: orchestrator.run_id,
        scope: STEP_NAMES.GITHUB_SEARCH_PASS2,
        data: { query: builtQuery.q, count: searchItems.length, pass: 2 },
      });
      searchStep.finish('success', { repos_found: searchItems.length });
    } catch (err) {
      searchStep.finish('failed', { error: String(err) });
      logger.error({ run_id: orchestrator.run_id, module: 'scout.pass2' }, `Search failed: ${String(err)}`);
      continue;
    }

    // Hydrate new repos
    const hydrateStep = orchestrator.startStep(STEP_NAMES.HYDRATE_README);
    let hydrateCount = 0;

    for (let i = 0; i < searchItems.length; i++) {
      const gh = searchItems[i];
      if (!gh) continue;

      // Dedupe: skip if already analyzed for this run
      const existingRepo = reposDao.getByFullName(gh.full_name);
      if (existingRepo && analysesDao.getByRepoAndRun(existingRepo.repo_id, orchestrator.run_id)) {
        // Already fully processed in this run — link but don't re-analyze
        queriesDao.linkRepoToQuery(existingRepo.repo_id, query_id, i + 1, 2);
        continue;
      }

      const [owner, repoName] = gh.full_name.split('/');
      const row = reposDao.upsert({
        full_name: gh.full_name,
        url: gh.html_url,
        stars: gh.stargazers_count,
        forks: gh.forks_count,
        topics: gh.topics ?? [],
        language: gh.language,
        license: gh.license?.spdx_id ?? null,
        pushed_at: gh.pushed_at,
        archived: gh.archived,
        fork: gh.fork,
        run_id: orchestrator.run_id,
      });
      queriesDao.linkRepoToQuery(row.repo_id, query_id, i + 1, 2);

      // Fetch readme only if not already in DB
      const hasReadme = db
        .prepare('SELECT readme_id FROM readmes WHERE repo_id = ?')
        .get(row.repo_id);

      if (!hasReadme && owner && repoName) {
        try {
          const readme = await getReadmeRaw(githubClient, owner, repoName);
          if (readme) {
            readmesDao.upsert({
              repo_id: row.repo_id,
              content_text: readme.content,
              etag: readme.etag,
              source_url: `https://api.github.com/repos/${owner}/${repoName}/readme`,
            });
            readmes_fetched++;
            hydrateCount++;
          }
        } catch {
          // Non-fatal: continue without readme
        }
      }

      repos_discovered++;
    }

    hydrateStep.finish('success', { hydrated: hydrateCount });
  }

  // ── Step 3: LLM Analysis for new repos ───────────────────────────────────
  // runAnalysis automatically skips repos already analyzed for this run_id
  const analyzeResult = await runAnalysis(db, orchestrator, {
    model: opts.model,
    apiKey: opts.apiKey,
    policyPath: opts.policyPath,
    _fetch: opts._fetch,
    _sleep: opts._sleep,
  });

  return {
    keywords_aggregated: aggregated.length,
    queries_run,
    repos_discovered,
    readmes_fetched,
    analyses_run: analyzeResult.analyzed,
    capped,
    cap_reason,
  };
}
