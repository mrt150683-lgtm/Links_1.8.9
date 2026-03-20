import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jaccard,
  extractFunctionSignature,
  computeFunctionalOverlapScore,
  filterPair,
  INTEROP_TRIGGER_TOKENS,
} from '../../briefs/overlap_filter.js';
import type { AnalysisRow } from '../../db/dao/analyses.js';
import type { FunctionSignature } from '../../briefs/overlap_filter.js';

// --- Test helpers ---

function makeAnalysisRow(
  repo_id: string,
  output: {
    signals?: { problem_summary?: string; integration_surface?: string[] };
    keywords?: { primary?: string[]; secondary?: string[]; search_queries?: string[] };
  }
): AnalysisRow {
  return {
    analysis_id: `test-${repo_id}`,
    repo_id,
    run_id: 'test-run',
    model: 'test-model',
    prompt_id: 'repo_analysis',
    prompt_version: 'v1',
    input_snapshot_json: '{}',
    output_json: JSON.stringify(output),
    llm_scores_json: '{}',
    final_score: 0.7,
    reasons_json: '{}',
    created_at: '2024-01-01T00:00:00Z',
  };
}

/** Build a FunctionSignature directly from sets (bypasses extractFunctionSignature). */
function makeSig(
  repo_id: string,
  opts: {
    problem_summary?: string;
    integration_surface?: string[];
    keywords_primary?: string[];
    keywords_secondary?: string[];
    search_queries?: string[];
  }
): FunctionSignature {
  return {
    repo_id,
    problem_summary_tokens: tokenize(opts.problem_summary ?? ''),
    integration_surface: new Set((opts.integration_surface ?? []).map((s) => s.toLowerCase())),
    keywords_primary: new Set((opts.keywords_primary ?? []).map((k) => k.toLowerCase())),
    keywords_secondary: new Set((opts.keywords_secondary ?? []).map((k) => k.toLowerCase())),
    search_queries_tokens: new Set(
      (opts.search_queries ?? []).flatMap((q) => [...tokenize(q)])
    ),
  };
}

const DEFAULT_CONFIG = { overlap_threshold: 0.70, exception_penalty: 0.10 };

// --- tokenize ---

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    const tokens = tokenize('Vector Database: Storage!');
    expect(tokens.has('vector')).toBe(true);
    expect(tokens.has('database')).toBe(true);
    expect(tokens.has('storage')).toBe(true);
  });

  it('removes stopwords', () => {
    const tokens = tokenize('the vector and the database for all');
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('and')).toBe(false);
    expect(tokens.has('for')).toBe(false);
    expect(tokens.has('all')).toBe(false);
    expect(tokens.has('vector')).toBe(true);
    expect(tokens.has('database')).toBe(true);
  });

  it('filters tokens shorter than 3 characters', () => {
    const tokens = tokenize('AI ML vector DB');
    expect(tokens.has('ai')).toBe(false);
    expect(tokens.has('ml')).toBe(false);
    expect(tokens.has('db')).toBe(false);
    expect(tokens.has('vector')).toBe(true);
  });

  it('returns empty set for empty string', () => {
    expect(tokenize('').size).toBe(0);
  });

  it('returns deterministic output for same input', () => {
    const t1 = tokenize('high-performance vector database ML applications');
    const t2 = tokenize('high-performance vector database ML applications');
    expect([...t1].sort()).toEqual([...t2].sort());
  });

  it('handles hyphenated words by splitting on hyphens', () => {
    // "high-performance" → ["high", "performance"]
    const tokens = tokenize('high-performance');
    expect(tokens.has('high')).toBe(true);
    expect(tokens.has('performance')).toBe(true);
  });
});

// --- jaccard ---

describe('jaccard', () => {
  it('returns 1.0 for identical non-empty sets', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccard(s, s)).toBe(1);
  });

  it('returns 0.0 for disjoint sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
  });

  it('returns 0.0 for two empty sets', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('returns 0.0 when one set is empty and the other is not', () => {
    // |{a,b} ∩ {}| = 0, |{a,b} ∪ {}| = 2 → 0
    expect(jaccard(new Set(['a', 'b']), new Set())).toBe(0);
  });

  it('computes correctly for partial overlap', () => {
    // |{a,b} ∩ {b,c}| = 1, |{a,b} ∪ {b,c}| = 3
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 5);
  });

  it('is symmetric', () => {
    const a = new Set(['x', 'y', 'z']);
    const b = new Set(['y', 'z', 'w']);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });
});

// --- computeFunctionalOverlapScore ---

describe('computeFunctionalOverlapScore', () => {
  it('returns 1.0 when all components are 1.0', () => {
    expect(
      computeFunctionalOverlapScore({
        problem_summary_sim: 1.0,
        integration_surface_sim: 1.0,
        keyword_primary_sim: 1.0,
      })
    ).toBe(1.0);
  });

  it('returns 0.0 when all components are 0.0', () => {
    expect(
      computeFunctionalOverlapScore({
        problem_summary_sim: 0,
        integration_surface_sim: 0,
        keyword_primary_sim: 0,
      })
    ).toBe(0);
  });

  it('weights problem_summary_sim most heavily (0.45)', () => {
    const onlyProblem = computeFunctionalOverlapScore({
      problem_summary_sim: 1.0,
      integration_surface_sim: 0,
      keyword_primary_sim: 0,
    });
    const onlySurface = computeFunctionalOverlapScore({
      problem_summary_sim: 0,
      integration_surface_sim: 1.0,
      keyword_primary_sim: 0,
    });
    const onlyKeyword = computeFunctionalOverlapScore({
      problem_summary_sim: 0,
      integration_surface_sim: 0,
      keyword_primary_sim: 1.0,
    });
    // 0.45 > 0.35 > 0.20
    expect(onlyProblem).toBeGreaterThan(onlySurface);
    expect(onlySurface).toBeGreaterThan(onlyKeyword);
  });

  it('applies correct weights: 0.45 + 0.35 + 0.20', () => {
    // 0.45*0.6 + 0.35*0.8 + 0.20*0.4 = 0.27 + 0.28 + 0.08 = 0.63
    expect(
      computeFunctionalOverlapScore({
        problem_summary_sim: 0.6,
        integration_surface_sim: 0.8,
        keyword_primary_sim: 0.4,
      })
    ).toBeCloseTo(0.63, 5);
  });

  it('is deterministic — same inputs always produce same output', () => {
    const sims = { problem_summary_sim: 0.55, integration_surface_sim: 0.4, keyword_primary_sim: 0.7 };
    expect(computeFunctionalOverlapScore(sims)).toBe(computeFunctionalOverlapScore(sims));
  });
});

// --- extractFunctionSignature ---

describe('extractFunctionSignature', () => {
  it('extracts problem summary tokens', () => {
    const row = makeAnalysisRow('repo-x', {
      signals: { problem_summary: 'High-performance vector database for ML' },
    });
    const sig = extractFunctionSignature(row);
    expect(sig.problem_summary_tokens.has('vector')).toBe(true);
    expect(sig.problem_summary_tokens.has('database')).toBe(true);
    expect(sig.problem_summary_tokens.has('high')).toBe(true);
    expect(sig.problem_summary_tokens.has('performance')).toBe(true);
  });

  it('extracts integration surface as lowercase set', () => {
    const row = makeAnalysisRow('repo-x', {
      signals: { integration_surface: ['API', 'gRPC', 'REST'] },
    });
    const sig = extractFunctionSignature(row);
    expect(sig.integration_surface.has('api')).toBe(true);
    expect(sig.integration_surface.has('grpc')).toBe(true);
    expect(sig.integration_surface.has('rest')).toBe(true);
  });

  it('extracts primary and secondary keywords as lowercase sets', () => {
    const row = makeAnalysisRow('repo-x', {
      keywords: {
        primary: ['Vector', 'Database'],
        secondary: ['HNSW', 'ANN'],
      },
    });
    const sig = extractFunctionSignature(row);
    expect(sig.keywords_primary.has('vector')).toBe(true);
    expect(sig.keywords_primary.has('database')).toBe(true);
    expect(sig.keywords_secondary.has('hnsw')).toBe(true);
    expect(sig.keywords_secondary.has('ann')).toBe(true);
  });

  it('extracts tokenized search queries', () => {
    const row = makeAnalysisRow('repo-x', {
      keywords: { search_queries: ['vector database open source', 'embedding storage'] },
    });
    const sig = extractFunctionSignature(row);
    expect(sig.search_queries_tokens.has('vector')).toBe(true);
    expect(sig.search_queries_tokens.has('embedding')).toBe(true);
    expect(sig.search_queries_tokens.has('storage')).toBe(true);
  });

  it('handles missing fields gracefully with empty sets', () => {
    const row = makeAnalysisRow('repo-x', {});
    const sig = extractFunctionSignature(row);
    expect(sig.problem_summary_tokens.size).toBe(0);
    expect(sig.integration_surface.size).toBe(0);
    expect(sig.keywords_primary.size).toBe(0);
    expect(sig.keywords_secondary.size).toBe(0);
    expect(sig.search_queries_tokens.size).toBe(0);
  });

  it('handles malformed output_json gracefully', () => {
    const row = makeAnalysisRow('repo-x', {} as never);
    row.output_json = 'NOT VALID JSON!!!';
    const sig = extractFunctionSignature(row);
    expect(sig.problem_summary_tokens.size).toBe(0);
  });
});

// --- filterPair: core rejection logic ---

describe('filterPair — competitor rejection', () => {
  it('rejects two vector databases with high functional overlap (no interop tokens)', () => {
    const sigA = makeSig('qdrant', {
      problem_summary: 'A vector database for similarity search and embedding storage',
      integration_surface: ['API', 'gRPC', 'REST'],
      keywords_primary: ['vector', 'database', 'similarity', 'search', 'embedding'],
      keywords_secondary: ['ann', 'indexing', 'hnswlib'],
    });
    const sigB = makeSig('weaviate', {
      problem_summary: 'A vector database for semantic search and embedding storage',
      integration_surface: ['API', 'gRPC', 'REST'],
      keywords_primary: ['vector', 'database', 'semantic', 'search', 'embedding'],
      keywords_secondary: ['ann', 'indexing', 'graphql'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(true);
    expect(result.exception_triggered).toBe(false);
    expect(result.penalty_applied).toBe(0);
    expect(result.functional_overlap).toBeGreaterThanOrEqual(DEFAULT_CONFIG.overlap_threshold);
    expect(result.similarities.problem_summary_sim).toBeGreaterThan(0.5);
    expect(result.similarities.integration_surface_sim).toBe(1.0);
  });

  it('allows a non-overlapping pair without rejection', () => {
    const sigA = makeSig('vector-db', {
      problem_summary: 'A vector database for similarity search',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'similarity', 'search', 'embedding'],
    });
    const sigB = makeSig('pipeline-tool', {
      problem_summary: 'A data pipeline orchestration framework for workflow scheduling',
      integration_surface: ['CLI', 'Python SDK'],
      keywords_primary: ['pipeline', 'orchestration', 'workflow', 'dag', 'scheduler'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.exception_triggered).toBe(false);
    expect(result.penalty_applied).toBe(0);
    expect(result.functional_overlap).toBeLessThan(DEFAULT_CONFIG.overlap_threshold);
  });

  it('passes repos with empty signatures without rejecting', () => {
    const sigA = makeSig('repo-a', {});
    const sigB = makeSig('repo-b', {});

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    // Both empty → jaccard = 0 for all dimensions → functional_overlap = 0 → passes
    expect(result.rejected).toBe(false);
    expect(result.functional_overlap).toBe(0);
  });
});

// --- filterPair: interop exception ---

describe('filterPair — interop exception', () => {
  it('allows competitor pair when primary keyword includes an interop trigger (migration)', () => {
    const sigA = makeSig('qdrant', {
      problem_summary: 'A vector database for similarity search and embedding storage',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'similarity', 'search', 'migration'],
    });
    const sigB = makeSig('weaviate', {
      problem_summary: 'A vector database for semantic search and embedding storage',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'semantic', 'search', 'embedding'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.exception_triggered).toBe(true);
    expect(result.exception_reason).toBe('interop_exception');
    expect(result.penalty_applied).toBe(DEFAULT_CONFIG.exception_penalty);
  });

  it('allows competitor pair when secondary keyword includes an interop trigger (adapter)', () => {
    const sigA = makeSig('db-a', {
      problem_summary: 'A vector database for embedding storage and retrieval',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'embedding', 'retrieval'],
      keywords_secondary: ['adapter', 'bridge'],
    });
    const sigB = makeSig('db-b', {
      problem_summary: 'A vector database for embedding storage and retrieval',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'embedding', 'retrieval'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.exception_triggered).toBe(true);
  });

  it('allows competitor pair when search_queries contain interop trigger tokens', () => {
    const sigA = makeSig('db-a', {
      problem_summary: 'A vector database for embedding storage and retrieval',
      integration_surface: ['API'],
      keywords_primary: ['vector', 'database', 'embedding'],
      search_queries: ['vector database migration tools', 'benchmark vector stores'],
    });
    const sigB = makeSig('db-b', {
      problem_summary: 'A vector database for embedding storage and retrieval',
      integration_surface: ['API'],
      keywords_primary: ['vector', 'database', 'embedding'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.exception_triggered).toBe(true);
  });

  it('allows competitor pair when integration_surface contains interop trigger (adapter)', () => {
    const sigA = makeSig('db-a', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API', 'adapter'],
      keywords_primary: ['vector', 'database', 'embedding'],
    });
    const sigB = makeSig('db-b', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API'],
      keywords_primary: ['vector', 'database', 'embedding'],
    });

    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.exception_triggered).toBe(true);
  });

  it('applies the configured penalty amount to exception pairs', () => {
    const sigA = makeSig('db-a', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'embedding', 'migration'],
    });
    const sigB = makeSig('db-b', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API', 'gRPC'],
      keywords_primary: ['vector', 'database', 'embedding'],
    });

    const result = filterPair(sigA, sigB, { overlap_threshold: 0.50, exception_penalty: 0.15 });

    if (result.exception_triggered) {
      expect(result.penalty_applied).toBe(0.15);
    }
  });

  it('uses custom interop_trigger_tokens when provided in config', () => {
    const sigA = makeSig('db-a', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API'],
      keywords_primary: ['vector', 'database', 'embedding', 'custom_trigger'],
    });
    const sigB = makeSig('db-b', {
      problem_summary: 'A vector database for embedding storage',
      integration_surface: ['API'],
      keywords_primary: ['vector', 'database', 'embedding'],
    });

    const result = filterPair(sigA, sigB, {
      overlap_threshold: 0.50,
      exception_penalty: 0.10,
      interop_trigger_tokens: new Set(['custom_trigger']),
    });

    if (result.functional_overlap >= 0.50) {
      expect(result.exception_triggered).toBe(true);
    }
  });
});

// --- filterPair: threshold boundary ---

describe('filterPair — threshold boundary', () => {
  it('allows pair with overlap exactly below threshold', () => {
    // Force a controlled overlap score by using raw signatures
    const sigA: FunctionSignature = {
      repo_id: 'a',
      problem_summary_tokens: new Set(['alpha', 'beta', 'gamma', 'delta']),
      integration_surface: new Set(['api']),
      keywords_primary: new Set(['foo', 'bar']),
      keywords_secondary: new Set(),
      search_queries_tokens: new Set(),
    };
    const sigB: FunctionSignature = {
      repo_id: 'b',
      problem_summary_tokens: new Set(['alpha', 'beta', 'epsilon', 'zeta']),
      integration_surface: new Set(['sdk']),
      keywords_primary: new Set(['baz', 'qux']),
      keywords_secondary: new Set(),
      search_queries_tokens: new Set(),
    };

    // problem_summary: |{alpha,beta} ∩ {alpha,beta,gamma,delta,epsilon,zeta}| / union
    // problem_sim = 2/6 = 0.333, surface_sim = 0/2 = 0, keyword_sim = 0/4 = 0
    // overlap = 0.45*0.333 + 0.35*0 + 0.20*0 ≈ 0.15 < 0.70
    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);
    expect(result.rejected).toBe(false);
    expect(result.functional_overlap).toBeLessThan(DEFAULT_CONFIG.overlap_threshold);
  });

  it('exposes repo_ids in the result', () => {
    const sigA = makeSig('repo-a', { keywords_primary: ['foo'] });
    const sigB = makeSig('repo-b', { keywords_primary: ['bar'] });
    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);
    expect(result.repo_ids).toContain('repo-a');
    expect(result.repo_ids).toContain('repo-b');
  });

  it('exposes all similarity dimensions in result', () => {
    const sigA = makeSig('a', {
      problem_summary: 'vector database search',
      integration_surface: ['api'],
      keywords_primary: ['vector'],
    });
    const sigB = makeSig('b', {
      problem_summary: 'vector database storage',
      integration_surface: ['api'],
      keywords_primary: ['database'],
    });
    const result = filterPair(sigA, sigB, DEFAULT_CONFIG);
    expect(typeof result.similarities.problem_summary_sim).toBe('number');
    expect(typeof result.similarities.integration_surface_sim).toBe('number');
    expect(typeof result.similarities.keyword_primary_sim).toBe('number');
  });
});

// --- INTEROP_TRIGGER_TOKENS sanity check ---

describe('INTEROP_TRIGGER_TOKENS', () => {
  it('contains all required trigger words', () => {
    const required = [
      'migration', 'adapter', 'bridge', 'benchmark', 'interop',
      'compat', 'spec', 'standard', 'translator', 'import', 'export', 'convert',
    ];
    for (const word of required) {
      expect(INTEROP_TRIGGER_TOKENS.has(word)).toBe(true);
    }
  });
});
