import type { AnalysisRow } from '../db/dao/analyses.js';

export interface BriefScoreComponents {
  avg_final_score: number;
  avg_collab_potential: number;
  overlap_score: number;
  brief_score: number;
}

/**
 * Compute a deterministic brief score from component analyses and their overlap score.
 * Formula: 0.4 * avg_final_score + 0.4 * avg_collab_potential + 0.2 * overlap_score
 */
export function computeBriefScore(
  analyses: AnalysisRow[],
  overlapScore: number
): BriefScoreComponents {
  if (analyses.length === 0) {
    return { avg_final_score: 0, avg_collab_potential: 0, overlap_score: 0, brief_score: 0 };
  }

  const avg_final_score =
    analyses.reduce((s, a) => s + a.final_score, 0) / analyses.length;

  const avg_collab_potential =
    analyses.reduce((s, a) => {
      try {
        const scores = JSON.parse(a.llm_scores_json) as { collaboration_potential?: number };
        return s + (scores.collaboration_potential ?? 0);
      } catch {
        return s;
      }
    }, 0) / analyses.length;

  const brief_score = Math.round(
    (0.4 * avg_final_score + 0.4 * avg_collab_potential + 0.2 * overlapScore) * 1_000_000
  ) / 1_000_000;

  return {
    avg_final_score: Math.round(avg_final_score * 1_000_000) / 1_000_000,
    avg_collab_potential: Math.round(avg_collab_potential * 1_000_000) / 1_000_000,
    overlap_score: overlapScore,
    brief_score,
  };
}
