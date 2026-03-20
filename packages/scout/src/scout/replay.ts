import type { Db } from '../db/index.js';
import { AnalysesDao } from '../db/dao/analyses.js';
import { computeFinalScore, loadScoringPolicy } from '../llm/scoring.js';
import type { RepoAnalysisOutput } from '../llm/schema.js';
import { logger } from '../logging/logger.js';

export interface ReplayOptions {
  /** Path to scoring policy JSON (optional, defaults to built-in policy). */
  policyPath?: string;
}

export interface ScoreDiff {
  repo_id: string;
  analysis_id: string;
  old_score: number;
  new_score: number;
  delta: number;
}

export interface ReplayResult {
  run_id: string;
  policy_version: string;
  replayed: number;
  changed: number;
  unchanged: number;
  diffs: ScoreDiff[];
}

/**
 * Replay scoring for all analyses in a run using the current (or specified) scoring policy.
 * Pure read operation — does not modify the database.
 * Returns score diffs so callers can see the impact of a policy change.
 */
export function replayScoring(
  db: Db,
  run_id: string,
  opts: ReplayOptions = {}
): ReplayResult {
  const policy = loadScoringPolicy(opts.policyPath);
  const analysesDao = new AnalysesDao(db);
  const analyses = analysesDao.listByRunId(run_id);

  let replayed = 0;
  let changed = 0;
  let unchanged = 0;
  const diffs: ScoreDiff[] = [];

  for (const analysis of analyses) {
    let output: RepoAnalysisOutput;
    try {
      output = JSON.parse(analysis.output_json) as RepoAnalysisOutput;
    } catch {
      logger.warn(
        { run_id, module: 'scout.replay', repo_id: analysis.repo_id },
        'Could not parse output_json — skipping'
      );
      continue;
    }

    let llmScores: { interestingness: number; novelty: number; collaboration_potential: number };
    try {
      llmScores = JSON.parse(analysis.llm_scores_json) as typeof llmScores;
    } catch {
      continue;
    }

    const newScore = computeFinalScore(llmScores, output.signals ?? {}, policy);
    const oldScore = analysis.final_score;
    const delta = Math.round((newScore - oldScore) * 1_000_000) / 1_000_000;

    replayed++;
    if (delta !== 0) {
      changed++;
      diffs.push({
        repo_id: analysis.repo_id,
        analysis_id: analysis.analysis_id,
        old_score: oldScore,
        new_score: newScore,
        delta,
      });
    } else {
      unchanged++;
    }
  }

  logger.info(
    { run_id, module: 'scout.replay' },
    `Replay complete: ${replayed} analyses, ${changed} scores changed`
  );

  return { run_id, policy_version: policy.version, replayed, changed, unchanged, diffs };
}
