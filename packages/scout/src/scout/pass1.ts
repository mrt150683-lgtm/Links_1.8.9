import { randomUUID } from 'crypto';
import type { Db } from '../db/index.js';
import type { GitHubClient } from '../github/client.js';
import type { RunOrchestrator } from './run_context.js';
import { STEP_NAMES } from './run_context.js';
import { buildSearchQuery } from '../github/query_builder.js';
import { searchRepos, getReadmeRaw, type GitHubRepo } from '../github/api.js';
import { ReposDao, ReadmesDao, GithubQueriesDao } from '../db/dao/repos.js';
import { AuditDao } from '../db/dao/audit.js';

export interface Pass1Options {
  query: string;
  days?: number;
  stars?: number;
  maxStars?: number;
  topN?: number;
  language?: string;
  includeForks?: boolean;
}

export interface Pass1Result {
  query_id: string;
  repos_found: number;
  repos_stored: number;
  readmes_fetched: number;
  readmes_missing: number;
}

export async function runPass1(
  db: Db,
  client: GitHubClient,
  orchestrator: RunOrchestrator,
  opts: Pass1Options
): Promise<Pass1Result> {
  const topN = opts.topN ?? 100;
  const reposDao = new ReposDao(db);
  const readmesDao = new ReadmesDao(db);
  const queriesDao = new GithubQueriesDao(db);
  const auditDao = new AuditDao(db);

  // Rate limit snapshot
  const rateLimitStep = orchestrator.startStep(STEP_NAMES.GITHUB_RATE_LIMIT_SNAPSHOT);
  try {
    const rateLimit = await client.getRateLimit();
    db.prepare(
      'INSERT INTO github_rate_limits (run_id, captured_at, payload_json) VALUES (?,?,?)'
    ).run(orchestrator.run_id, new Date().toISOString(), JSON.stringify(rateLimit.data));
    auditDao.write({
      event: 'github.rate_limit_snapshot',
      message: 'GitHub rate limit snapshot captured',
      run_id: orchestrator.run_id,
      data: {
        core_remaining: rateLimit.data.resources.core.remaining,
        search_remaining: rateLimit.data.resources.search.remaining,
      },
    });
    rateLimitStep.finish('success');
  } catch (err) {
    rateLimitStep.finish('failed', { error: String(err) });
    throw err;
  }

  // Search repositories
  const searchStep = orchestrator.startStep(STEP_NAMES.GITHUB_SEARCH_PASS1);
  const builtQuery = buildSearchQuery({
    query: opts.query,
    days: opts.days,
    stars: opts.stars,
    maxStars: opts.maxStars,
    language: opts.language,
    includeForks: opts.includeForks,
  });

  const query_id = randomUUID();
  queriesDao.create({
    query_id,
    run_id: orchestrator.run_id,
    pass: 1,
    query_string: builtQuery.q,
    params: builtQuery.params,
  });

  let allRepos: GitHubRepo[] = [];
  let page = 1;
  const perPage = Math.min(30, topN);

  try {
    while (allRepos.length < topN) {
      const result = await searchRepos(client, {
        q: builtQuery.q,
        per_page: perPage,
        page,
        sort: 'stars',
        order: 'desc',
      });

      allRepos = allRepos.concat(result.items);

      if (result.incomplete_results || result.items.length < perPage) break;
      if (allRepos.length >= topN) break;
      page++;
    }

    // Trim to topN
    allRepos = allRepos.slice(0, topN);

    auditDao.write({
      event: 'github.search.completed',
      message: `Search returned ${allRepos.length} repos`,
      run_id: orchestrator.run_id,
      data: { query: builtQuery.q, count: allRepos.length, pass: 1 },
    });

    searchStep.finish('success', { repos_found: allRepos.length });
  } catch (err) {
    searchStep.finish('failed', { error: String(err) });
    throw err;
  }

  // Store repos
  let repos_stored = 0;
  const repoRows = [];
  for (let i = 0; i < allRepos.length; i++) {
    const gh = allRepos[i];
    if (!gh) continue;
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
    queriesDao.linkRepoToQuery(row.repo_id, query_id, i + 1, 1);
    repoRows.push({ row, owner, repoName });
    repos_stored++;
  }

  // Hydrate READMEs
  const hydrateStep = orchestrator.startStep(STEP_NAMES.HYDRATE_README);
  let readmes_fetched = 0;
  let readmes_missing = 0;

  for (const { row, owner, repoName } of repoRows) {
    if (!owner || !repoName) continue;

    auditDao.write({
      event: 'repo.hydrate.started',
      message: `Hydrating ${row.full_name}`,
      run_id: orchestrator.run_id,
      data: { repo: row.full_name },
    });

    try {
      const readme = await getReadmeRaw(client, owner, repoName);
      if (readme) {
        readmesDao.upsert({
          repo_id: row.repo_id,
          content_text: readme.content,
          etag: readme.etag,
          source_url: `https://api.github.com/repos/${owner}/${repoName}/readme`,
        });
        auditDao.write({
          event: 'repo.readme.fetched',
          message: `README fetched for ${row.full_name}`,
          run_id: orchestrator.run_id,
          data: {
            repo: row.full_name,
            bytes: readme.content.length,
          },
        });
        readmes_fetched++;
      } else {
        auditDao.write({
          event: 'repo.readme.missing',
          message: `No README for ${row.full_name}`,
          run_id: orchestrator.run_id,
          data: { repo: row.full_name },
        });
        readmes_missing++;
      }
    } catch (err) {
      auditDao.write({
        level: 'error',
        event: 'repo.hydrate.failed',
        message: `Failed to hydrate ${row.full_name}`,
        run_id: orchestrator.run_id,
        data: { repo: row.full_name, error: String(err) },
      });
    }
  }

  hydrateStep.finish('success', { readmes_fetched, readmes_missing });

  return { query_id, repos_found: allRepos.length, repos_stored, readmes_fetched, readmes_missing };
}
