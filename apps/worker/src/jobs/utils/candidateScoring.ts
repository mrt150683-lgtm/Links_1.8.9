/**
 * Phase 8: Candidate Scoring Utilities
 *
 * Deterministic heuristics for generating link candidates
 * - Entity overlap scoring
 * - Tag overlap scoring
 * - Keyword similarity (Jaccard)
 * - Time proximity scoring
 * - Source URL matching
 */

import type { Entry } from '@links/storage';
import type { EntitiesArtifact, TagsArtifact } from '@links/core';

/**
 * Scoring weights version 1
 * These weights are versioned to enable tuning without breaking existing scores
 */
export const SCORE_WEIGHTS_V1 = {
  entity_overlap: 0.6,
  tag_overlap: 0.3,
  keyword_overlap: 0.1,
};

/**
 * Thresholds for candidate generation
 */
export const CANDIDATE_THRESHOLDS = {
  MIN_SCORE: 0.15, // Minimum total score to generate candidate
  MIN_ENTITY_OVERLAP: 1, // At least 1 shared entity
  MIN_TAG_OVERLAP: 1, // At least 1 shared tag
  MIN_KEYWORD_JACCARD: 0.1, // Min Jaccard similarity for keywords
};

/**
 * Limits for candidate generation
 */
export const CANDIDATE_LIMITS = {
  MAX_CANDIDATES_PER_ENTRY: 30,
  MAX_COMPARISON_POOL_SIZE: 200, // Compare against most recent N entries
};

/**
 * Candidate score breakdown
 */
export interface CandidateScore {
  total: number;
  entity_score: number;
  tag_score: number;
  keyword_score: number;
  reason: string;
}

/**
 * Calculate entity overlap score
 *
 * Computes Jaccard similarity of entity labels weighted by confidence.
 * Higher confidence entities contribute more to the score.
 *
 * @param entities1 - First entry's entities artifact
 * @param entities2 - Second entry's entities artifact
 * @returns Normalized score 0..1
 */
export function calculateEntityOverlap(
  entities1: EntitiesArtifact | null,
  entities2: EntitiesArtifact | null
): number {
  if (!entities1 || !entities2) return 0;
  if (entities1.entities.length === 0 || entities2.entities.length === 0) return 0;

  // Create weighted sets (label -> confidence)
  const set1 = new Map<string, number>();
  const set2 = new Map<string, number>();

  for (const entity of entities1.entities) {
    const key = `${entity.type}:${entity.label.toLowerCase()}`;
    set1.set(key, Math.max(set1.get(key) ?? 0, entity.confidence));
  }

  for (const entity of entities2.entities) {
    const key = `${entity.type}:${entity.label.toLowerCase()}`;
    set2.set(key, Math.max(set2.get(key) ?? 0, entity.confidence));
  }

  // Calculate weighted Jaccard similarity
  let intersectionWeight = 0;
  let unionWeight = 0;

  const allKeys = new Set([...set1.keys(), ...set2.keys()]);

  for (const key of allKeys) {
    const conf1 = set1.get(key) ?? 0;
    const conf2 = set2.get(key) ?? 0;

    if (conf1 > 0 && conf2 > 0) {
      // Intersection: take minimum confidence
      intersectionWeight += Math.min(conf1, conf2);
    }

    // Union: take maximum confidence
    unionWeight += Math.max(conf1, conf2);
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

/**
 * Calculate tag overlap score
 *
 * Computes Jaccard similarity of tag labels weighted by confidence.
 *
 * @param tags1 - First entry's tags artifact
 * @param tags2 - Second entry's tags artifact
 * @returns Normalized score 0..1
 */
export function calculateTagOverlap(
  tags1: TagsArtifact | null,
  tags2: TagsArtifact | null
): number {
  if (!tags1 || !tags2) return 0;
  if (tags1.tags.length === 0 || tags2.tags.length === 0) return 0;

  // Create weighted sets (label -> confidence)
  const set1 = new Map<string, number>();
  const set2 = new Map<string, number>();

  for (const tag of tags1.tags) {
    const key = tag.label.toLowerCase();
    set1.set(key, Math.max(set1.get(key) ?? 0, tag.confidence));
  }

  for (const tag of tags2.tags) {
    const key = tag.label.toLowerCase();
    set2.set(key, Math.max(set2.get(key) ?? 0, tag.confidence));
  }

  // Calculate weighted Jaccard similarity
  let intersectionWeight = 0;
  let unionWeight = 0;

  const allKeys = new Set([...set1.keys(), ...set2.keys()]);

  for (const key of allKeys) {
    const conf1 = set1.get(key) ?? 0;
    const conf2 = set2.get(key) ?? 0;

    if (conf1 > 0 && conf2 > 0) {
      intersectionWeight += Math.min(conf1, conf2);
    }

    unionWeight += Math.max(conf1, conf2);
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

/**
 * Calculate keyword similarity using Jaccard index
 *
 * Tokenizes entry texts, removes stopwords, and computes Jaccard similarity
 * of the token sets.
 *
 * @param text1 - First entry content text
 * @param text2 - Second entry content text
 * @returns Jaccard similarity 0..1
 */
export function calculateKeywordSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Calculate Jaccard similarity: |intersection| / |union|
  let intersectionSize = 0;
  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = tokens1.size + tokens2.size - intersectionSize;

  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

/**
 * Tokenize text into normalized tokens (lowercase, alphanumeric, no stopwords)
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();

  // Split on whitespace and punctuation, lowercase, filter short tokens
  const words = text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

  for (const word of words) {
    tokens.add(word);
  }

  return tokens;
}

/**
 * Common English stopwords (minimal set for performance)
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
  'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did',
  'she', 'use', 'way', 'been', 'call', 'come', 'each', 'find', 'from',
  'have', 'into', 'long', 'look', 'made', 'make', 'many', 'more', 'part',
  'said', 'than', 'that', 'them', 'then', 'this', 'time', 'very', 'were',
  'what', 'when', 'will', 'with', 'word', 'your',
]);

/**
 * Check if two entries have matching source URLs
 */
export function haveMatchingSourceUrls(entry1: Entry, entry2: Entry): boolean {
  if (!entry1.source_url || !entry2.source_url) return false;

  // Exact match
  if (entry1.source_url === entry2.source_url) return true;

  // Domain match (optional: could be useful for same-site content)
  try {
    const url1 = new URL(entry1.source_url);
    const url2 = new URL(entry2.source_url);
    return url1.hostname === url2.hostname;
  } catch {
    return false;
  }
}

/**
 * Calculate time proximity score
 *
 * Entries captured closer in time get higher scores.
 * Falls off exponentially with time difference.
 *
 * @param timestamp1 - First entry captured_at (ms)
 * @param timestamp2 - Second entry captured_at (ms)
 * @param halfLifeHours - Time difference for 50% score (default 24h)
 * @returns Score 0..1
 */
export function calculateTimeProximity(
  timestamp1: number,
  timestamp2: number,
  halfLifeHours: number = 24
): number {
  const timeDiffMs = Math.abs(timestamp1 - timestamp2);
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  // Exponential decay: score = 0.5^(diff/halfLife)
  return Math.pow(0.5, timeDiffHours / halfLifeHours);
}

/**
 * Calculate overall candidate score
 *
 * Combines entity, tag, and keyword overlap scores using weighted sum.
 *
 * @param entities1 - First entry entities artifact
 * @param entities2 - Second entry entities artifact
 * @param tags1 - First entry tags artifact
 * @param tags2 - Second entry tags artifact
 * @param text1 - First entry content text
 * @param text2 - Second entry content text
 * @returns Candidate score breakdown
 */
export function calculateCandidateScore(
  entities1: EntitiesArtifact | null,
  entities2: EntitiesArtifact | null,
  tags1: TagsArtifact | null,
  tags2: TagsArtifact | null,
  text1: string,
  text2: string
): CandidateScore {
  const entity_score = calculateEntityOverlap(entities1, entities2);
  const tag_score = calculateTagOverlap(tags1, tags2);
  const keyword_score = calculateKeywordSimilarity(text1, text2);

  // Weighted sum
  const total =
    entity_score * SCORE_WEIGHTS_V1.entity_overlap +
    tag_score * SCORE_WEIGHTS_V1.tag_overlap +
    keyword_score * SCORE_WEIGHTS_V1.keyword_overlap;

  // Determine primary reason
  let reason = 'low_score';
  if (entity_score >= CANDIDATE_THRESHOLDS.MIN_ENTITY_OVERLAP / 3) {
    reason = 'shared_entities';
  } else if (tag_score >= CANDIDATE_THRESHOLDS.MIN_TAG_OVERLAP / 3) {
    reason = 'shared_tags';
  } else if (keyword_score >= CANDIDATE_THRESHOLDS.MIN_KEYWORD_JACCARD) {
    reason = 'keyword_sim';
  }

  return {
    total: Math.min(1.0, total), // Cap at 1.0
    entity_score,
    tag_score,
    keyword_score,
    reason,
  };
}
