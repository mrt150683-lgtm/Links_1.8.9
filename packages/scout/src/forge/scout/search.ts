import { randomUUID } from 'crypto';
import type { Db } from '../../db/index.js';
import type { GitHubClient } from '../../github/client.js';
import type { ForgeRunOrchestrator } from './run_context.js';
import { FORGE_STEP_NAMES } from './run_context.js';
import { searchRepos, getReadmeRaw } from '../../github/api.js';
import { ReposDao, ReadmesDao, GithubQueriesDao } from '../../db/dao/repos.js';
import { loadPrompt, fillTemplate } from '../../llm/prompt_registry.js';
import { callOpenRouterJson } from '../../llm/client.js';

export async function runForgeSearch(
  db: Db,
  client: GitHubClient,
  orchestrator: ForgeRunOrchestrator,
  opts: {
    model: string;
    apiKey: string;
    maxQueries?: number;
    maxResultsPerQuery?: number;
  }
): Promise<{ repos_found: number; summaries_generated: number }> {
  const maxQueries = opts.maxQueries ?? 10;
  const maxResultsPerQuery = opts.maxResultsPerQuery ?? 10;
  
  const reposDao = new ReposDao(db);
  const readmesDao = new ReadmesDao(db);
  const queriesDao = new GithubQueriesDao(db);

  const searchStep = orchestrator.startStep(FORGE_STEP_NAMES.FORGE_SEARCH);
  
  // Get generated queries for this run
  const queries = db.prepare('SELECT * FROM github_queries WHERE run_id = ? AND pass = 1').all(orchestrator.run_id) as any[];
  const queriesToRun = queries.slice(0, maxQueries);

  let totalFound = 0;
  let summariesGenerated = 0;
  const processedRepoIds = new Set<string>();

  try {
    for (const q of queriesToRun) {
      orchestrator.logForgeAudit({
        event: 'search.query_started',
        message: `Executing query: ${q.query_string}`,
        data: { query: q.query_string }
      });

      const fullQuery = `${q.query_string} stars:10..3000`;
      
      const result = await searchRepos(client, {
        q: fullQuery,
        per_page: maxResultsPerQuery,
        page: 1,
        sort: 'stars',
        order: 'desc'
      });

      for (let i = 0; i < result.items.length; i++) {
        const gh = result.items[i];
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
          run_id: orchestrator.run_id
        });

        queriesDao.linkRepoToQuery(row.repo_id, q.query_id, i + 1, 1);
        
        if (!processedRepoIds.has(row.repo_id)) {
          processedRepoIds.add(row.repo_id);
          totalFound++;

          // Hydrate README
          const [owner, repoName] = gh.full_name.split('/');
          try {
            const readme = await getReadmeRaw(client, owner, repoName);
            if (readme) {
              readmesDao.upsert({
                repo_id: row.repo_id,
                content_text: readme.content,
                etag: readme.etag,
                source_url: `https://api.github.com/repos/${owner}/${repoName}/readme`
              });

              // Summarize
              const prompt = loadPrompt('forge_summary', 'v1');
              const filled = fillTemplate(prompt.template, {
                readme_content: readme.content.slice(0, 5000)
              });

              const llmOutput = await callOpenRouterJson({
                model: opts.model,
                apiKey: opts.apiKey,
                messages: [{ role: 'user', content: filled }],
                temperature: prompt.meta.model_defaults.temperature,
                max_tokens: prompt.meta.model_defaults.max_tokens
              }) as { summary: string };

              // Store summary in analyses (partial analysis for now)
              db.prepare(`
                INSERT INTO analyses (
                  analysis_id, repo_id, run_id, model, prompt_id, prompt_version, 
                  input_snapshot_json, output_json, llm_scores_json, final_score, 
                  reasons_json, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
              `).run(
                randomUUID(),
                row.repo_id,
                orchestrator.run_id,
                opts.model,
                'forge_summary',
                'v1',
                JSON.stringify({ readme_len: readme.content.length }),
                JSON.stringify(llmOutput),
                JSON.stringify({}),
                0,
                JSON.stringify(['Cheap summary generated during search']),
                new Date().toISOString()
              );

              summariesGenerated++;
            }
          } catch (err) {
            orchestrator.logForgeAudit({
              level: 'warn',
              event: 'search.hydrate_failed',
              message: `Failed to hydrate/summarize ${gh.full_name}`,
              data: { error: String(err) }
            });
          }
        }
      }
    }

    searchStep.finish('success', { repos_found: totalFound, summaries_generated: summariesGenerated });
    return { repos_found: totalFound, summaries_generated: summariesGenerated };

  } catch (err) {
    searchStep.finish('failed', { error: String(err) });
    throw err;
  }
}
