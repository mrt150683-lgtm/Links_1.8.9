import { randomUUID } from 'crypto';
import type { Db } from '../../db/index.js';
import type { ForgeRunOrchestrator } from './run_context.js';
import { GitHubClient, GitHubApiError } from '../../github/client.js';
import { loadPrompt, fillTemplate } from '../../llm/prompt_registry.js';
import { callOpenRouterJson } from '../../llm/client.js';
import { ForgeRepoSeedOutputSchema, ForgeKeywordStormOutputSchema } from '../llm/schema.js';
import { ReposDao, ReadmesDao, GithubQueriesDao } from '../../db/dao/repos.js';
import { KeywordsDao } from '../../db/dao/analyses.js';

export interface SeedIngestionResult {
  keywords: string[];
  search_queries: string[];
}

/**
 * Repo Mode: Fetch user repo metadata + README, analyze with cheap LLM to get keywords.
 */
export async function ingestRepoSeed(
  db: Db,
  ghClient: GitHubClient,
  orchestrator: ForgeRunOrchestrator,
  opts: {
    repo_full_name: string;
    model: string;
    apiKey: string;
    localReadmePath?: string;
    focus?: string;
  }
): Promise<SeedIngestionResult> {
  const step = orchestrator.startStep('seed_ingestion');
  const reposDao = new ReposDao(db);
  const readmesDao = new ReadmesDao(db);
  const queriesDao = new GithubQueriesDao(db);
  const keywordsDao = new KeywordsDao(db);

  try {
    let repo;
    let readmeText;

    if (opts.localReadmePath) {
      import('fs').then(fs => {
        if (!fs.existsSync(opts.localReadmePath!)) throw new Error(`Local README not found: ${opts.localReadmePath}`);
      });
      const fs = await import('fs');
      readmeText = fs.readFileSync(opts.localReadmePath, 'utf-8');
      
      repo = reposDao.upsert({
        full_name: opts.repo_full_name,
        url: `https://github.com/${opts.repo_full_name}`,
        stars: 100,
        forks: 10,
        topics: ['simulated'],
        language: 'TypeScript',
        license: 'MIT',
        pushed_at: new Date().toISOString(),
        archived: false,
        fork: false,
        run_id: orchestrator.run_id,
      });

      readmesDao.upsert({
        repo_id: repo.repo_id,
        content_text: readmeText,
        source_url: `local://${opts.localReadmePath}`,
      });
    } else {
      // 1. Fetch repo metadata
      const repoResp = await ghClient.request<any>({ path: `/repos/${opts.repo_full_name}` });
      repo = reposDao.upsert({
        full_name: repoResp.data.full_name,
        url: repoResp.data.html_url,
        stars: repoResp.data.stargazers_count,
        forks: repoResp.data.forks_count,
        topics: repoResp.data.topics ?? [],
        language: repoResp.data.language,
        license: repoResp.data.license?.spdx_id ?? repoResp.data.license?.name,
        pushed_at: repoResp.data.pushed_at,
        archived: repoResp.data.archived,
        fork: repoResp.data.fork,
        run_id: orchestrator.run_id,
      });

      // 2. Fetch README (404 = no README in repo root — continue without it)
      try {
        const readmeResp = await ghClient.request<any>({
          path: `/repos/${opts.repo_full_name}/readme`,
          accept: 'application/vnd.github.raw',
        });
        readmeText = readmeResp.data ?? '';
      } catch (readmeErr) {
        if (readmeErr instanceof GitHubApiError && readmeErr.status === 404) {
          readmeText = '';
        } else {
          throw readmeErr;
        }
      }

      if (readmeText) {
        readmesDao.upsert({
          repo_id: repo.repo_id,
          content_text: readmeText,
          source_url: `https://github.com/${opts.repo_full_name}/blob/main/README.md`,
        });
      }
    }

    // 3. Analyze with cheap LLM
    const prompt = loadPrompt('forge_repo_seed', 'v1');
    const filled = fillTemplate(prompt.template, {
      full_name: repo.full_name,
      stars: String(repo.stars),
      language: repo.language ?? 'N/A',
      topics: (repo.topics_json ? JSON.parse(repo.topics_json) : []).join(', '),
      license: repo.license ?? 'N/A',
      pushed_at: repo.pushed_at ?? 'N/A',
      focus: opts.focus ?? 'General logical addons and complementary projects',
      readme_content: readmeText.slice(0, 10000), // Cap README size
    });

    const llmOutput = await callOpenRouterJson({
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [{ role: 'user', content: filled }],
      temperature: prompt.meta.model_defaults.temperature,
      max_tokens: prompt.meta.model_defaults.max_tokens,
    });

    const parsed = ForgeRepoSeedOutputSchema.parse(llmOutput);

    // 4. Store keywords & queries
    for (const kw of parsed.keywords) {
      keywordsDao.insert({
        run_id: orchestrator.run_id,
        repo_id: repo.repo_id,
        keyword: kw,
        kind: 'primary',
        weight: 1.0,
      });
    }

    for (const query of parsed.search_queries) {
      queriesDao.create({
        query_id: randomUUID(),
        run_id: orchestrator.run_id,
        pass: 1,
        query_string: query,
        params: { mode: 'repo_seed', source_repo: opts.repo_full_name },
      });
    }

    step.finish('success', { 
      repo: repo.full_name, 
      keyword_count: parsed.keywords.length, 
      query_count: parsed.search_queries.length 
    });

    return {
      keywords: parsed.keywords,
      search_queries: parsed.search_queries,
    };
  } catch (err) {
    step.finish('failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Idea Mode: Use cheap LLM to generate keyword storm from raw prompt.
 */
export async function ingestIdeaSeed(
  db: Db,
  orchestrator: ForgeRunOrchestrator,
  opts: {
    prompt: string;
    focus?: string;
    model: string;
    apiKey: string;
  }
): Promise<SeedIngestionResult> {
  const step = orchestrator.startStep('seed_ingestion');
  const queriesDao = new GithubQueriesDao(db);
  const keywordsDao = new KeywordsDao(db);

  try {
    const prompt = loadPrompt('forge_keyword_storm', 'v1');
    const filled = fillTemplate(prompt.template, {
      prompt: opts.prompt,
      focus: opts.focus ?? 'General exploration of the idea',
    });

    const llmOutput = await callOpenRouterJson({
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [{ role: 'user', content: filled }],
      temperature: prompt.meta.model_defaults.temperature,
      max_tokens: prompt.meta.model_defaults.max_tokens,
    });

    const parsed = ForgeKeywordStormOutputSchema.parse(llmOutput);

    // Store keywords & queries
    for (const kw of parsed.keywords) {
      keywordsDao.insert({
        run_id: orchestrator.run_id,
        repo_id: null,
        keyword: kw,
        kind: 'primary',
        weight: 1.0,
      });
    }

    for (const query of parsed.search_queries) {
      queriesDao.create({
        query_id: randomUUID(),
        run_id: orchestrator.run_id,
        pass: 1,
        query_string: query,
        params: { mode: 'idea_seed' },
      });
    }

    step.finish('success', { 
      keyword_count: parsed.keywords.length, 
      query_count: parsed.search_queries.length 
    });

    return {
      keywords: parsed.keywords,
      search_queries: parsed.search_queries,
    };
  } catch (err) {
    step.finish('failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
