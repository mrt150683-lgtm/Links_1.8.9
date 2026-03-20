import type { AnalysisRow } from '../db/dao/analyses.js';
import type { RepoRow } from '../db/dao/repos.js';

export interface CandidateGroup {
  /** Sorted repo_ids (deterministic). */
  repo_ids: string[];
  /** 0–1 overlap/complement score used in brief scoring. */
  overlap_score: number;
}

export interface GrouperOptions {
  /** Min final_score to qualify (default 0.60). */
  minRepoScore?: number;
  /** Min collaboration_potential to qualify (default 0.65). */
  minCollabPotential?: number;
  /** Max 2-repo combos to evaluate (default 200). */
  maxCombos?: number;
  /** Group size (default 2). */
  groupSize?: 2 | 3;
}

interface RepoMeta {
  repo_id: string;
  topics: Set<string>;
  language: string | null;
  integration_surface: Set<string>;
  collab_potential: number;
  final_score: number;
}

function parseTopics(topics_json: string | null): Set<string> {
  if (!topics_json) return new Set();
  try {
    const arr = JSON.parse(topics_json) as unknown[];
    return new Set(arr.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase()));
  } catch {
    return new Set();
  }
}

function parseIntegrationSurface(output_json: string): Set<string> {
  try {
    const output = JSON.parse(output_json) as { signals?: { integration_surface?: string[] } };
    const surface = output.signals?.integration_surface ?? [];
    return new Set(surface.map((s) => s.toLowerCase()));
  } catch {
    return new Set();
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scorePair(a: RepoMeta, b: RepoMeta): number {
  const topicOverlap = jaccard(a.topics, b.topics) * 0.4;
  const langMatch = a.language && b.language && a.language === b.language ? 0.2 : 0;
  const surfaceOverlap = jaccard(a.integration_surface, b.integration_surface) * 0.2;
  // Complementary: one produces (has API/SDK), other doesn't → good pairing
  const aHasApi = a.integration_surface.has('api') || a.integration_surface.has('sdk');
  const bHasApi = b.integration_surface.has('api') || b.integration_surface.has('sdk');
  const complementBonus = aHasApi !== bHasApi ? 0.2 : 0;

  return Math.round((topicOverlap + langMatch + surfaceOverlap + complementBonus) * 1_000_000) / 1_000_000;
}

/**
 * Generate deterministic candidate groups from qualifying analyses.
 * Groups are sorted by overlap_score desc, then by repo_ids string asc.
 */
export function generateCandidateGroups(
  analyses: AnalysisRow[],
  repos: RepoRow[],
  opts: GrouperOptions = {}
): CandidateGroup[] {
  const minRepoScore = opts.minRepoScore ?? 0.6;
  const minCollabPotential = opts.minCollabPotential ?? 0.65;
  const maxCombos = opts.maxCombos ?? 200;

  const repoById = new Map<string, RepoRow>(repos.map((r) => [r.repo_id, r]));

  // Filter qualifying analyses
  const qualified: RepoMeta[] = [];
  for (const analysis of analyses) {
    if (analysis.final_score < minRepoScore) continue;

    let collabPotential: number;
    try {
      const scores = JSON.parse(analysis.llm_scores_json) as { collaboration_potential?: number };
      collabPotential = scores.collaboration_potential ?? 0;
    } catch {
      collabPotential = 0;
    }
    if (collabPotential < minCollabPotential) continue;

    const repo = repoById.get(analysis.repo_id);
    if (!repo) continue;

    qualified.push({
      repo_id: analysis.repo_id,
      topics: parseTopics(repo.topics_json),
      language: repo.language,
      integration_surface: parseIntegrationSurface(analysis.output_json),
      collab_potential: collabPotential,
      final_score: analysis.final_score,
    });
  }

  if (qualified.length < 2) return [];

  // Sort for determinism before generating combos
  qualified.sort((a, b) => a.repo_id.localeCompare(b.repo_id));

  const groups: CandidateGroup[] = [];
  let combosEvaluated = 0;

  // Generate pairs (and optionally triples)
  for (let i = 0; i < qualified.length; i++) {
    for (let j = i + 1; j < qualified.length; j++) {
      if (combosEvaluated >= maxCombos) break;
      combosEvaluated++;

      const a = qualified[i]!;
      const b = qualified[j]!;
      const overlap_score = scorePair(a, b);
      const repo_ids = [a.repo_id, b.repo_id].sort();

      groups.push({ repo_ids, overlap_score });

      // Optionally add triples
      if (opts.groupSize === 3) {
        for (let k = j + 1; k < qualified.length; k++) {
          if (combosEvaluated >= maxCombos) break;
          combosEvaluated++;
          const c = qualified[k]!;
          const tripleScore = (scorePair(a, b) + scorePair(b, c) + scorePair(a, c)) / 3;
          groups.push({
            repo_ids: [a.repo_id, b.repo_id, c.repo_id].sort(),
            overlap_score: Math.round(tripleScore * 1_000_000) / 1_000_000,
          });
        }
      }
    }
    if (combosEvaluated >= maxCombos) break;
  }

  // Sort deterministically: overlap_score desc, then repo_ids string asc
  groups.sort((a, b) => {
    if (b.overlap_score !== a.overlap_score) return b.overlap_score - a.overlap_score;
    return a.repo_ids.join(',').localeCompare(b.repo_ids.join(','));
  });

  return groups;
}
