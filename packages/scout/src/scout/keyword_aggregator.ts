import type { Db } from '../db/index.js';
import { KeywordsDao } from '../db/dao/analyses.js';
import type { AnalysisRow } from '../db/dao/analyses.js';

export type KeywordKind = 'primary' | 'secondary' | 'search_query';

export interface AggregatedKeyword {
  keyword: string;
  kind: KeywordKind;
  weight: number;
}

interface RawKeyword {
  keyword: string;
  kind: string;
  weight: number;
  repo_id: string;
}

/**
 * Aggregate per-repo keywords into run-level keywords weighted by final_score.
 * Takes the top-K analyses by final_score, then for each keyword sums:
 *   contribution = keyword.weight * repo.final_score
 * Stores the result in the keywords table with repo_id = NULL.
 * Returns sorted list (by weight desc, then keyword asc for determinism).
 */
export function aggregateKeywords(
  db: Db,
  run_id: string,
  topK = 20
): AggregatedKeyword[] {
  const analyses = db
    .prepare('SELECT * FROM analyses WHERE run_id = ? ORDER BY final_score DESC LIMIT ?')
    .all(run_id, topK) as AnalysisRow[];

  if (analyses.length === 0) return [];

  const scoreByRepo = new Map<string, number>(analyses.map((a) => [a.repo_id, a.final_score]));
  const repoIds = analyses.map((a) => a.repo_id);
  const placeholders = repoIds.map(() => '?').join(',');

  const rawKeywords = db
    .prepare(
      `SELECT keyword, kind, weight, repo_id FROM keywords
       WHERE run_id = ? AND repo_id IN (${placeholders})`
    )
    .all(run_id, ...repoIds) as RawKeyword[];

  // Weighted aggregation: keyword+kind → sum of (weight * final_score)
  const agg = new Map<string, { keyword: string; kind: string; weight: number }>();
  for (const kw of rawKeywords) {
    const normalized = kw.keyword.toLowerCase().trim();
    const key = `${kw.kind}:${normalized}`;
    const repoScore = scoreByRepo.get(kw.repo_id) ?? 0;
    const contribution = kw.weight * repoScore;

    const existing = agg.get(key);
    if (existing) {
      existing.weight += contribution;
    } else {
      agg.set(key, { keyword: normalized, kind: kw.kind, weight: contribution });
    }
  }

  // Sort deterministically: weight desc, then keyword asc
  const sorted = Array.from(agg.values()).sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.keyword.localeCompare(b.keyword);
  });

  // Store back as run-level keywords (repo_id = NULL)
  const kwDao = new KeywordsDao(db);
  const result: AggregatedKeyword[] = [];

  for (const kw of sorted) {
    kwDao.insert({
      run_id,
      repo_id: null,
      keyword: kw.keyword,
      kind: kw.kind as KeywordKind,
      weight: Math.round(kw.weight * 1_000_000) / 1_000_000,
    });
    result.push({
      keyword: kw.keyword,
      kind: kw.kind as KeywordKind,
      weight: Math.round(kw.weight * 1_000_000) / 1_000_000,
    });
  }

  return result;
}

/**
 * Generate Pass 2 search query strings from aggregated keywords.
 * Prefers search_query kind first, then fills from primary keywords.
 * Returns at most maxQueries strings.
 */
export function generatePass2QueryStrings(
  aggregated: AggregatedKeyword[],
  maxQueries = 10
): string[] {
  const queries: string[] = [];

  // 1. Use search_query keywords directly (already formed query strings)
  for (const kw of aggregated) {
    if (kw.kind === 'search_query' && queries.length < maxQueries) {
      queries.push(kw.keyword);
    }
  }

  // 2. Fill remaining slots with top primary keywords as single-term queries
  for (const kw of aggregated) {
    if (kw.kind === 'primary' && queries.length < maxQueries) {
      if (!queries.includes(kw.keyword)) {
        queries.push(kw.keyword);
      }
    }
  }

  return queries;
}
