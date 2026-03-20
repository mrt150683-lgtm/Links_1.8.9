import type { Db } from '../db/index.js';
import type { RunOrchestrator } from '../scout/run_context.js';
import { STEP_NAMES } from '../scout/run_context.js';
import { AnalysesDao } from '../db/dao/analyses.js';
import type { AnalysisRow } from '../db/dao/analyses.js';
import { BriefsDao } from '../db/dao/briefs.js';
import type { BriefStatus } from '../db/dao/briefs.js';
import { callOpenRouterJson, OpenRouterInvalidOutputError } from '../llm/client.js';
import { loadPrompt, fillTemplate } from '../llm/prompt_registry.js';
import { validateBriefOutput } from '../llm/brief_schema.js';
import type { BriefOutput } from '../llm/brief_schema.js';
import { generateCandidateGroups } from './grouper.js';
import type { CandidateGroup } from './grouper.js';
import { computeBriefScore } from './scorer.js';
import {
  extractFunctionSignature,
  filterPair,
} from './overlap_filter.js';
import type { FunctionSignature } from './overlap_filter.js';
import type { RepoRow } from '../db/dao/repos.js';
import { logger } from '../logging/logger.js';

const PROMPT_ID = 'brief_generate';
const PROMPT_VERSION = 'v1';

export interface GeneratorOptions {
  model: string;
  apiKey: string;
  minRepoScore?: number;
  minCollabPotential?: number;
  minBriefScore?: number;
  maxBriefs?: number;
  maxCombos?: number;
  /**
   * Functional overlap threshold (0–1). Pairs with overlap >= threshold are
   * treated as competitors and rejected unless an interop exception fires.
   * Default: 0.70. Set to a value > 1 (e.g. 1.1) to disable the filter.
   */
  overlapThreshold?: number;
  /**
   * Score penalty subtracted from overlap_score for exception-allowed pairs.
   * Default: 0.10.
   */
  overlapExceptionPenalty?: number;
  /**
   * Max number of top-scored historical repos from other runs to inject into the
   * candidate pool. Set to 0 to disable. Default: 100.
   */
  historyCandidates?: number;
  /**
   * The user's own repo (e.g. "owner/repo"). Exempt from the per-repo dedup cap
   * so it can appear in every brief regardless of how many times it's been shortlisted.
   */
  ownRepo?: string;
  _fetch?: typeof fetch;
  _sleep?: (ms: number) => Promise<void>;
}

export interface GenerateResult {
  candidates_evaluated: number;
  briefs_generated: number;
  briefs_shortlisted: number;
  briefs_rejected: number;
  failed: number;
  /** Candidate groups rejected by the overlap filter (deterministic, pre-LLM). */
  pairs_rejected_overlap: number;
  /** Competitor pairs allowed through via interop exception (with penalty applied). */
  pairs_allowed_exception: number;
  /** Number of historical repos injected from previous runs. */
  history_candidates_injected: number;
}

interface RepoWithAnalysis {
  repo: RepoRow;
  analysis: AnalysisRow;
}

interface FilteredGroup {
  group: CandidateGroup;
  /** Amount subtracted from overlap_score when computing brief_score. */
  penalty: number;
}

function buildReposData(items: RepoWithAnalysis[]): string {
  const data = items.map(({ repo, analysis }) => {
    let signals: { problem_summary?: string; who_is_it_for?: string; integration_surface?: string[] } = {};
    try {
      const out = JSON.parse(analysis.output_json) as { signals?: typeof signals };
      signals = out.signals ?? {};
    } catch {
      // ignore
    }
    return {
      full_name: repo.full_name,
      stars: repo.stars,
      language: repo.language,
      topics: repo.topics_json ? (JSON.parse(repo.topics_json) as string[]) : [],
      license: repo.license,
      problem_summary: signals.problem_summary ?? null,
      who_is_it_for: signals.who_is_it_for ?? null,
      integration_surface: signals.integration_surface ?? [],
      final_score: analysis.final_score,
    };
  });
  return JSON.stringify(data, null, 2);
}

function renderBriefMd(brief: BriefOutput, score: number): string {
  const repoLines = brief.repos
    .map(
      (r) =>
        `### ${r.full_name}\n**Why it fits:** ${r.why_it_fits}\n**Integration role:** ${r.integration_role}`
    )
    .join('\n\n');

  return `# ${brief.title}

> **Score:** ${score.toFixed(4)}

## Concept

${brief.concept}

## Repositories

${repoLines}
`;
}

function renderOutreachMd(brief: BriefOutput): string {
  return `> **Manual review required. This tool does not post to GitHub automatically.**
> Review and personalise before sending.

---

${brief.outreach_message}
`;
}

/**
 * Apply the deterministic overlap filter to a single candidate group.
 * Handles pairs (2-repo) and triples (3-repo, all internal pairs checked).
 *
 * Returns FilteredGroup if the group should proceed to LLM, or null if rejected.
 * Logs audit events for each rejection and each allowed exception.
 */
function applyOverlapFilter(
  group: CandidateGroup,
  signatures: Map<string, FunctionSignature>,
  config: { overlap_threshold: number; exception_penalty: number },
  orchestrator: RunOrchestrator
): FilteredGroup | null {
  const ids = group.repo_ids;
  let maxPenalty = 0;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sigA = signatures.get(ids[i]!);
      const sigB = signatures.get(ids[j]!);

      // Missing signature → can't filter, pass through
      if (!sigA || !sigB) continue;

      const result = filterPair(sigA, sigB, {
        overlap_threshold: config.overlap_threshold,
        exception_penalty: config.exception_penalty,
      });

      if (result.rejected) {
        orchestrator.logAudit({
          event: 'briefs.pair_rejected_overlap',
          message: `Pair rejected as functional duplicates: ${ids[i]},${ids[j]} (overlap=${result.functional_overlap.toFixed(4)}, threshold=${config.overlap_threshold})`,
          scope: STEP_NAMES.LLM_BRIEF_GENERATE,
          data: {
            repoA: ids[i],
            repoB: ids[j],
            functional_overlap: result.functional_overlap,
            sims: result.similarities,
            threshold: config.overlap_threshold,
          },
        });
        // Any rejected internal pair rejects the whole group
        return null;
      }

      if (result.exception_triggered) {
        orchestrator.logAudit({
          event: 'briefs.pair_allowed_exception',
          message: `Competitor pair allowed via interop exception: ${ids[i]},${ids[j]} (overlap=${result.functional_overlap.toFixed(4)}, penalty=${result.penalty_applied})`,
          scope: STEP_NAMES.LLM_BRIEF_GENERATE,
          data: {
            repoA: ids[i],
            repoB: ids[j],
            functional_overlap: result.functional_overlap,
            exception_reason: result.exception_reason,
            penalty_applied: result.penalty_applied,
          },
        });
        maxPenalty = Math.max(maxPenalty, result.penalty_applied);
      }
    }
  }

  return { group, penalty: maxPenalty };
}

export async function generateBriefs(
  db: Db,
  orchestrator: RunOrchestrator,
  opts: GeneratorOptions
): Promise<GenerateResult> {
  const minBriefScore = opts.minBriefScore ?? 0.75;
  const maxBriefs = opts.maxBriefs ?? 50;
  const overlapThreshold = opts.overlapThreshold ?? 0.70;
  const overlapExceptionPenalty = opts.overlapExceptionPenalty ?? 0.10;

  const historyCandidatesLimit = opts.historyCandidates ?? 100;

  const step = orchestrator.startStep(STEP_NAMES.LLM_BRIEF_GENERATE);

  const analysesDao = new AnalysesDao(db);
  const briefsDao = new BriefsDao(db);

  // Load all analyses + repos for this run
  const analyses = analysesDao.listByRunId(orchestrator.run_id);
  const repos = db
    .prepare(
      `SELECT DISTINCT r.* FROM repos r
       JOIN repo_query_links rql ON rql.repo_id = r.repo_id
       JOIN github_queries gq ON gq.query_id = rql.query_id
       WHERE gq.run_id = ?`
    )
    .all(orchestrator.run_id) as RepoRow[];

  // Inject top-scored historical repos from previous runs
  const currentRepoIds = new Set(analyses.map((a) => a.repo_id));
  let history_candidates_injected = 0;

  if (historyCandidatesLimit > 0) {
    // Fetch the best analysis per repo from other runs, excluding repos already in this run
    const historicalAnalyses = db
      .prepare(
        `SELECT a.* FROM analyses a
         INNER JOIN (
           SELECT repo_id, MAX(final_score) AS max_score
           FROM analyses
           WHERE run_id != ?
           GROUP BY repo_id
         ) best ON a.repo_id = best.repo_id AND a.final_score = best.max_score
         WHERE a.repo_id NOT IN (SELECT repo_id FROM analyses WHERE run_id = ?)
         ORDER BY a.final_score DESC
         LIMIT ?`
      )
      .all(orchestrator.run_id, orchestrator.run_id, historyCandidatesLimit) as AnalysisRow[];

    if (historicalAnalyses.length > 0) {
      // Load repo rows for the historical analyses
      const histRepoIds = historicalAnalyses.map((a) => a.repo_id);
      const placeholders = histRepoIds.map(() => '?').join(',');
      const histRepos = db
        .prepare(`SELECT * FROM repos WHERE repo_id IN (${placeholders})`)
        .all(...histRepoIds) as RepoRow[];

      // Merge into current run's arrays (only repos we don't already have)
      const histRepoById = new Map<string, RepoRow>(histRepos.map((r) => [r.repo_id, r]));
      for (const ha of historicalAnalyses) {
        if (!currentRepoIds.has(ha.repo_id)) {
          analyses.push(ha);
          const hr = histRepoById.get(ha.repo_id);
          if (hr) repos.push(hr);
          currentRepoIds.add(ha.repo_id);
          history_candidates_injected++;
        }
      }

      logger.info(
        { run_id: orchestrator.run_id, module: 'briefs.generator' },
        `History injection: ${history_candidates_injected} repos from previous runs added to candidate pool`
      );
      orchestrator.logAudit({
        event: 'briefs.history.injected',
        message: `Injected ${history_candidates_injected} historical repos into candidate pool`,
        scope: STEP_NAMES.LLM_BRIEF_GENERATE,
        data: { history_candidates_injected, limit: historyCandidatesLimit },
      });
    }
  }

  const prompt = loadPrompt(PROMPT_ID, PROMPT_VERSION);
  const repoById = new Map<string, RepoRow>(repos.map((r) => [r.repo_id, r]));
  const analysisByRepoId = new Map<string, AnalysisRow>(analyses.map((a) => [a.repo_id, a]));

  // Generate candidate groups (deterministic, sorted by overlap_score desc)
  const groups = generateCandidateGroups(analyses, repos, {
    minRepoScore: opts.minRepoScore,
    minCollabPotential: opts.minCollabPotential,
    maxCombos: opts.maxCombos,
  });

  // Build function signatures from stored analysis output (deterministic)
  const signatures = new Map<string, FunctionSignature>();
  for (const analysis of analyses) {
    signatures.set(analysis.repo_id, extractFunctionSignature(analysis));
  }

  // Apply overlap filter to all candidate groups before any LLM calls
  const filteredGroups: FilteredGroup[] = [];
  let pairs_rejected_overlap = 0;
  let pairs_allowed_exception = 0;

  for (const group of groups) {
    const filtered = applyOverlapFilter(
      group,
      signatures,
      { overlap_threshold: overlapThreshold, exception_penalty: overlapExceptionPenalty },
      orchestrator
    );

    if (filtered === null) {
      pairs_rejected_overlap++;
    } else {
      if (filtered.penalty > 0) pairs_allowed_exception++;
      filteredGroups.push(filtered);
    }
  }

  logger.info(
    { run_id: orchestrator.run_id, module: 'briefs.generator' },
    `Overlap filter: ${groups.length} groups → ${filteredGroups.length} passed, ${pairs_rejected_overlap} rejected, ${pairs_allowed_exception} exceptions`
  );

  let briefs_generated = 0;
  let briefs_shortlisted = 0;
  let briefs_rejected = 0;
  let failed = 0;
  let candidates_evaluated = 0;

  // Resolve own repo full_name → repo_id (exempt from dedup cap)
  const ownRepoId = opts.ownRepo
    ? (repos.find((r) => r.full_name.toLowerCase() === opts.ownRepo!.toLowerCase())?.repo_id ?? null)
    : null;

  // Track repos that already anchor a shortlisted brief — each repo gets one top-billing slot.
  // Own repo is exempt: it should appear in every brief when the user is searching from their own project.
  const shortlistedRepos = new Set<string>();

  for (const { group, penalty } of filteredGroups) {
    if (briefs_generated >= maxBriefs) break;

    // Skip groups where any repo has already appeared in a shortlisted brief,
    // unless the group contains the user's own repo (always allowed through).
    const hasOwnRepo = ownRepoId !== null && group.repo_ids.includes(ownRepoId);
    const anyAlreadyShortlisted = !hasOwnRepo && group.repo_ids.some((id) => shortlistedRepos.has(id));
    if (anyAlreadyShortlisted) continue;

    candidates_evaluated++;

    const items: RepoWithAnalysis[] = [];
    for (const repo_id of group.repo_ids) {
      const repo = repoById.get(repo_id);
      const analysis = analysisByRepoId.get(repo_id);
      if (repo && analysis) items.push({ repo, analysis });
    }
    if (items.length < 2) continue;

    // Apply exception penalty to overlap_score before brief scoring
    const adjustedOverlapScore = Math.max(0, group.overlap_score - penalty);
    const scoreComps = computeBriefScore(
      items.map((i) => i.analysis),
      adjustedOverlapScore
    );

    const filledPrompt = fillTemplate(prompt.template, {
      repos_data: buildReposData(items),
    });

    let briefOutput: BriefOutput;
    try {
      const raw = await callOpenRouterJson({
        model: opts.model,
        apiKey: opts.apiKey,
        temperature: prompt.meta.model_defaults.temperature,
        max_tokens: prompt.meta.model_defaults.max_tokens,
        messages: [{ role: 'user', content: filledPrompt }],
        _fetch: opts._fetch,
        _sleep: opts._sleep,
      });
      briefOutput = validateBriefOutput(raw);
    } catch (err) {
      failed++;
      const isInvalidOutput = err instanceof OpenRouterInvalidOutputError;
      orchestrator.logAudit({
        level: 'error',
        event: isInvalidOutput ? 'llm.output.invalid_json' : 'brief.generation.error',
        message: `Brief generation failed for group ${group.repo_ids.join(',')}: ${err instanceof Error ? err.message : String(err)}`,
        scope: STEP_NAMES.LLM_BRIEF_GENERATE,
        data: { repo_ids: group.repo_ids },
      });
      logger.error(
        { run_id: orchestrator.run_id, module: 'briefs.generator' },
        `Brief generation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const status: BriefStatus =
      scoreComps.brief_score >= minBriefScore ? 'shortlisted' : 'rejected_by_threshold';

    const brief_md = renderBriefMd(briefOutput, scoreComps.brief_score);
    const outreach_md = renderOutreachMd(briefOutput);

    briefsDao.insert({
      run_id: orchestrator.run_id,
      score: scoreComps.brief_score,
      repo_ids: group.repo_ids,
      brief: { ...briefOutput, score_components: scoreComps },
      brief_md,
      outreach_md,
      status,
    });

    briefs_generated++;
    if (status === 'shortlisted') {
      briefs_shortlisted++;
      for (const id of group.repo_ids) {
        if (id !== ownRepoId) shortlistedRepos.add(id);
      }
    } else {
      briefs_rejected++;
    }

    orchestrator.logAudit({
      event: 'brief.generated',
      message: `Brief generated: ${briefOutput.title} (score=${scoreComps.brief_score}, status=${status})`,
      scope: STEP_NAMES.LLM_BRIEF_GENERATE,
      data: {
        repo_ids: group.repo_ids,
        score: scoreComps.brief_score,
        status,
      },
    });
  }

  const stepStatus = failed > 0 && briefs_generated === 0 ? 'failed' : 'success';
  step.finish(stepStatus, {
    candidates_evaluated,
    briefs_generated,
    briefs_shortlisted,
    briefs_rejected,
    failed,
    pairs_rejected_overlap,
    pairs_allowed_exception,
    history_candidates_injected,
  });

  return {
    candidates_evaluated,
    briefs_generated,
    briefs_shortlisted,
    briefs_rejected,
    failed,
    pairs_rejected_overlap,
    pairs_allowed_exception,
    history_candidates_injected,
  };
}
