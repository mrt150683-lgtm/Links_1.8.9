import type { Db } from '../db/index.js';
import type { RunOrchestrator } from './run_context.js';
import { STEP_NAMES } from './run_context.js';
import { callOpenRouterJson, OpenRouterInvalidOutputError } from '../llm/client.js';
import { loadPrompt, fillTemplate } from '../llm/prompt_registry.js';
import { validateRepoAnalysisOutput } from '../llm/schema.js';
import { loadScoringPolicy, computeFinalScore } from '../llm/scoring.js';
import { AnalysesDao, KeywordsDao } from '../db/dao/analyses.js';
import { logger } from '../logging/logger.js';

const PROMPT_ID = 'repo_analysis';
const PROMPT_VERSION = 'v1';

/** Max README characters sent to the LLM (to control cost and token usage). */
const DEFAULT_MAX_README_CHARS = 8000;

export interface AnalyzeOptions {
  model: string;
  apiKey: string;
  policyPath?: string;
  maxReadmeChars?: number;
  _fetch?: typeof fetch;
  _sleep?: (ms: number) => Promise<void>;
}

export interface AnalyzeResult {
  analyzed: number;
  failed: number;
  keywords_stored: number;
}

interface RepoWithReadme {
  repo_id: string;
  full_name: string;
  stars: number;
  language: string | null;
  license: string | null;
  pushed_at: string | null;
  topics_json: string | null;
  readme_content: string | null;
  readme_sha256: string | null;
}

function getReposForRun(db: Db, run_id: string): RepoWithReadme[] {
  return db
    .prepare(
      `SELECT DISTINCT r.repo_id, r.full_name, r.stars, r.language, r.license,
              r.pushed_at, r.topics_json,
              rm.content_text AS readme_content, rm.sha256 AS readme_sha256
       FROM repos r
       JOIN repo_query_links rql ON rql.repo_id = r.repo_id
       JOIN github_queries gq ON gq.query_id = rql.query_id
       LEFT JOIN readmes rm ON rm.repo_id = r.repo_id
       WHERE gq.run_id = ?`
    )
    .all(run_id) as RepoWithReadme[];
}

export async function runAnalysis(
  db: Db,
  orchestrator: RunOrchestrator,
  opts: AnalyzeOptions
): Promise<AnalyzeResult> {
  const step = orchestrator.startStep(STEP_NAMES.LLM_REPO_ANALYSIS);

  const policy = loadScoringPolicy(opts.policyPath);
  const prompt = loadPrompt(PROMPT_ID, PROMPT_VERSION);
  const maxReadmeChars = opts.maxReadmeChars ?? DEFAULT_MAX_README_CHARS;

  const analysesDao = new AnalysesDao(db);
  const keywordsDao = new KeywordsDao(db);

  const repos = getReposForRun(db, orchestrator.run_id);

  let analyzed = 0;
  let failed = 0;
  let keywords_stored = 0;

  for (const repo of repos) {
    // Skip repos already analyzed in this run (supports re-entrant calls from pass2)
    if (analysesDao.getByRepoAndRun(repo.repo_id, orchestrator.run_id)) {
      continue;
    }

    if (!repo.readme_content) {
      orchestrator.logAudit({
        level: 'info',
        scope: STEP_NAMES.LLM_REPO_ANALYSIS,
        event: 'repo.analysis.skipped',
        message: `Skipped analysis for ${repo.full_name}: no README`,
        data: { repo_id: repo.repo_id, full_name: repo.full_name },
      });
      continue;
    }

    const topics: string[] = repo.topics_json ? (JSON.parse(repo.topics_json) as string[]) : [];
    const readmeExcerpt = repo.readme_content.slice(0, maxReadmeChars);

    const filledPrompt = fillTemplate(prompt.template, {
      full_name: repo.full_name,
      stars: String(repo.stars),
      language: repo.language ?? 'unknown',
      topics: topics.join(', ') || 'none',
      license: repo.license ?? 'unknown',
      pushed_at: repo.pushed_at ?? 'unknown',
      readme_content: readmeExcerpt,
    });

    const inputSnapshot = {
      full_name: repo.full_name,
      stars: repo.stars,
      language: repo.language,
      license: repo.license,
      pushed_at: repo.pushed_at,
      topics,
      readme_sha256: repo.readme_sha256,
      readme_chars: readmeExcerpt.length,
      prompt_id: PROMPT_ID,
      prompt_version: PROMPT_VERSION,
      model: opts.model,
    };

    try {
      const rawOutput = await callOpenRouterJson({
        model: opts.model,
        apiKey: opts.apiKey,
        temperature: prompt.meta.model_defaults.temperature,
        max_tokens: prompt.meta.model_defaults.max_tokens,
        messages: [{ role: 'user', content: filledPrompt }],
        _fetch: opts._fetch,
        _sleep: opts._sleep,
      });

      const output = validateRepoAnalysisOutput(rawOutput);
      const finalScore = computeFinalScore(output.scores, output.signals, policy);

      analysesDao.insert({
        repo_id: repo.repo_id,
        run_id: orchestrator.run_id,
        model: opts.model,
        prompt_id: PROMPT_ID,
        prompt_version: PROMPT_VERSION,
        input_snapshot: inputSnapshot,
        output,
        llm_scores: {
          interestingness: output.scores.interestingness,
          novelty: output.scores.novelty,
          collaboration_potential: output.scores.collaboration_potential,
        },
        final_score: finalScore,
        reasons: output.reasons,
      });

      // Store keywords
      for (const kw of output.keywords.primary) {
        keywordsDao.insert({ run_id: orchestrator.run_id, repo_id: repo.repo_id, keyword: kw, kind: 'primary' });
        keywords_stored++;
      }
      for (const kw of output.keywords.secondary) {
        keywordsDao.insert({ run_id: orchestrator.run_id, repo_id: repo.repo_id, keyword: kw, kind: 'secondary' });
        keywords_stored++;
      }
      for (const kw of output.keywords.search_queries) {
        keywordsDao.insert({ run_id: orchestrator.run_id, repo_id: repo.repo_id, keyword: kw, kind: 'search_query' });
        keywords_stored++;
      }

      logger.info(
        { run_id: orchestrator.run_id, module: 'scout.analyze', repo: repo.full_name, final_score: finalScore },
        `Analysis complete for ${repo.full_name}`
      );

      orchestrator.logAudit({
        event: 'repo.analysis.complete',
        message: `Analysis complete for ${repo.full_name}`,
        scope: STEP_NAMES.LLM_REPO_ANALYSIS,
        data: { repo_id: repo.repo_id, full_name: repo.full_name, final_score: finalScore },
      });

      analyzed++;
    } catch (err) {
      failed++;

      const isInvalidOutput = err instanceof OpenRouterInvalidOutputError;
      const event = isInvalidOutput ? 'llm.output.invalid_json' : 'repo.analysis.error';
      const message = err instanceof Error ? err.message : String(err);

      logger.error(
        { run_id: orchestrator.run_id, module: 'scout.analyze', repo: repo.full_name },
        `Analysis failed for ${repo.full_name}: ${message}`
      );

      orchestrator.logAudit({
        level: 'error',
        event,
        message: `Analysis failed for ${repo.full_name}: ${message}`,
        scope: STEP_NAMES.LLM_REPO_ANALYSIS,
        data: { repo_id: repo.repo_id, full_name: repo.full_name, error: message },
      });
    }
  }

  const stepStatus = failed > 0 && analyzed === 0 ? 'failed' : 'success';
  step.finish(stepStatus, { analyzed, failed, keywords_stored });

  return { analyzed, failed, keywords_stored };
}
