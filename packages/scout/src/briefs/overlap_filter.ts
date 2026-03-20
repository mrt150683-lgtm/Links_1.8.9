import type { AnalysisRow } from '../db/dao/analyses.js';

// --- Public types ---

export interface FunctionSignature {
  repo_id: string;
  problem_summary_tokens: Set<string>;
  integration_surface: Set<string>;
  keywords_primary: Set<string>;
  keywords_secondary: Set<string>;
  search_queries_tokens: Set<string>;
}

export interface OverlapSimilarities {
  problem_summary_sim: number;
  integration_surface_sim: number;
  keyword_primary_sim: number;
}

export interface PairFilterResult {
  repo_ids: [string, string];
  functional_overlap: number;
  similarities: OverlapSimilarities;
  rejected: boolean;
  exception_triggered: boolean;
  exception_reason: string | null;
  penalty_applied: number;
}

export interface OverlapFilterConfig {
  overlap_threshold: number;
  exception_penalty: number;
  /** Override the default interop trigger token set (useful in tests). */
  interop_trigger_tokens?: Set<string>;
}

// --- Stopwords (excluded from tokenization) ---

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'did',
  'from', 'that', 'this', 'they', 'will', 'with', 'have', 'been', 'each',
  'into', 'more', 'than', 'them', 'then', 'well', 'were', 'what', 'when',
  'your', 'also', 'any', 'via', 'use', 'used', 'using', 'tool', 'tools',
]);

// --- Interoperability exception trigger tokens ---

export const INTEROP_TRIGGER_TOKENS = new Set([
  'migration', 'migrate', 'interop', 'compat', 'compatibility',
  'adapter', 'bridge', 'benchmark', 'benchmarks', 'spec', 'standard', 'standards',
  'translator', 'import', 'export', 'convert', 'conversion',
]);

// --- Core text utilities ---

/**
 * Tokenize a string: lowercase, split on non-alphanumeric boundaries,
 * remove stopwords, discard tokens shorter than 3 characters.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty (no information → no similarity).
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// --- Signature extraction ---

interface AnalysisOutput {
  signals?: {
    problem_summary?: string;
    integration_surface?: string[];
  };
  keywords?: {
    primary?: string[];
    secondary?: string[];
    search_queries?: string[];
  };
}

/**
 * Extract a deterministic function signature from a stored analysis row.
 * All fields come directly from the stored output_json — no inference.
 */
export function extractFunctionSignature(analysis: AnalysisRow): FunctionSignature {
  let output: AnalysisOutput = {};
  try {
    output = JSON.parse(analysis.output_json) as AnalysisOutput;
  } catch {
    // empty fallback
  }

  const signals = output.signals ?? {};
  const keywords = output.keywords ?? {};

  return {
    repo_id: analysis.repo_id,
    problem_summary_tokens: tokenize(signals.problem_summary ?? ''),
    integration_surface: new Set(
      (signals.integration_surface ?? []).map((s) => s.toLowerCase())
    ),
    keywords_primary: new Set(
      (keywords.primary ?? []).map((k) => k.toLowerCase())
    ),
    keywords_secondary: new Set(
      (keywords.secondary ?? []).map((k) => k.toLowerCase())
    ),
    search_queries_tokens: new Set(
      (keywords.search_queries ?? []).flatMap((q) => [...tokenize(q)])
    ),
  };
}

// --- Similarity computation ---

/**
 * Compute per-dimension Jaccard similarities between two function signatures.
 */
export function computeOverlapSimilarities(
  sigA: FunctionSignature,
  sigB: FunctionSignature
): OverlapSimilarities {
  return {
    problem_summary_sim: jaccard(sigA.problem_summary_tokens, sigB.problem_summary_tokens),
    integration_surface_sim: jaccard(sigA.integration_surface, sigB.integration_surface),
    keyword_primary_sim: jaccard(sigA.keywords_primary, sigB.keywords_primary),
  };
}

/**
 * Compute the weighted functional overlap score from component similarities.
 *
 * Formula: 0.45 × problem_summary_sim
 *        + 0.35 × integration_surface_sim
 *        + 0.20 × keyword_primary_sim
 *
 * Result is rounded to 6 decimal places for determinism.
 */
export function computeFunctionalOverlapScore(sims: OverlapSimilarities): number {
  return (
    Math.round(
      (0.45 * sims.problem_summary_sim +
        0.35 * sims.integration_surface_sim +
        0.20 * sims.keyword_primary_sim) *
        1_000_000
    ) / 1_000_000
  );
}

// --- Interop exception detection ---

function hasInteropToken(sig: FunctionSignature, triggerSet: Set<string>): boolean {
  for (const token of sig.keywords_primary) {
    if (triggerSet.has(token)) return true;
  }
  for (const token of sig.keywords_secondary) {
    if (triggerSet.has(token)) return true;
  }
  for (const token of sig.search_queries_tokens) {
    if (triggerSet.has(token)) return true;
  }
  for (const token of sig.integration_surface) {
    if (triggerSet.has(token)) return true;
  }
  return false;
}

// --- Main filter function ---

/**
 * Determine whether a candidate pair should be rejected as functional duplicates/competitors.
 *
 * Decision flow:
 *   1. Compute functional_overlap from weighted Jaccard similarities.
 *   2. If overlap < threshold → allow (no penalty).
 *   3. If overlap >= threshold AND either repo carries an interop trigger token
 *      (migration, adapter, bridge, benchmark, …) → allow with penalty.
 *   4. Otherwise → reject.
 *
 * Returns a detailed result for audit logging.
 */
export function filterPair(
  sigA: FunctionSignature,
  sigB: FunctionSignature,
  config: OverlapFilterConfig
): PairFilterResult {
  const triggerSet = config.interop_trigger_tokens ?? INTEROP_TRIGGER_TOKENS;
  const sims = computeOverlapSimilarities(sigA, sigB);
  const functional_overlap = computeFunctionalOverlapScore(sims);

  const repo_ids: [string, string] = [sigA.repo_id, sigB.repo_id];

  if (functional_overlap < config.overlap_threshold) {
    return {
      repo_ids,
      functional_overlap,
      similarities: sims,
      rejected: false,
      exception_triggered: false,
      exception_reason: null,
      penalty_applied: 0,
    };
  }

  // High overlap — check for interop exception before rejecting
  if (hasInteropToken(sigA, triggerSet) || hasInteropToken(sigB, triggerSet)) {
    return {
      repo_ids,
      functional_overlap,
      similarities: sims,
      rejected: false,
      exception_triggered: true,
      exception_reason: 'interop_exception',
      penalty_applied: config.exception_penalty,
    };
  }

  return {
    repo_ids,
    functional_overlap,
    similarities: sims,
    rejected: true,
    exception_triggered: false,
    exception_reason: null,
    penalty_applied: 0,
  };
}
