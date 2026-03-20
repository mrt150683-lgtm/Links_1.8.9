import { describe, it, expect } from 'vitest';
import { validateRepoAnalysisOutput } from '../../llm/schema.js';

const validOutput = {
  repo: { full_name: 'example/repo-alpha' },
  scores: { interestingness: 0.8, novelty: 0.7, collaboration_potential: 0.75 },
  reasons: {
    interestingness: ['Interesting reason one', 'Interesting reason two'],
    novelty: ['Novel approach'],
    collaboration_potential: ['Has API'],
  },
  signals: {
    problem_summary: 'Solves a hard problem',
    who_is_it_for: 'ML engineers',
    integration_surface: ['API', 'SDK'],
    risk_flags: [],
  },
  keywords: {
    primary: ['vector', 'database'],
    secondary: ['HNSW', 'ANN'],
    search_queries: ['vector database open source'],
  },
};

describe('validateRepoAnalysisOutput', () => {
  it('accepts a fully valid output', () => {
    const result = validateRepoAnalysisOutput(validOutput);
    expect(result.repo.full_name).toBe('example/repo-alpha');
    expect(result.scores.interestingness).toBe(0.8);
  });

  it('accepts minimal signals (all optional fields absent)', () => {
    const minimal = {
      ...validOutput,
      signals: {},
    };
    const result = validateRepoAnalysisOutput(minimal);
    expect(result.signals.problem_summary).toBeUndefined();
    expect(result.signals.risk_flags).toBeUndefined();
  });

  it('throws on missing repo.full_name', () => {
    const bad = { ...validOutput, repo: {} };
    expect(() => validateRepoAnalysisOutput(bad)).toThrow();
  });

  it('throws on score out of range (> 1)', () => {
    const bad = { ...validOutput, scores: { ...validOutput.scores, interestingness: 1.5 } };
    expect(() => validateRepoAnalysisOutput(bad)).toThrow();
  });

  it('throws on score out of range (< 0)', () => {
    const bad = { ...validOutput, scores: { ...validOutput.scores, novelty: -0.1 } };
    expect(() => validateRepoAnalysisOutput(bad)).toThrow();
  });

  it('throws on non-string items in reasons array', () => {
    const bad = {
      ...validOutput,
      reasons: { ...validOutput.reasons, interestingness: [123] },
    };
    expect(() => validateRepoAnalysisOutput(bad)).toThrow();
  });

  it('throws if keywords.primary exceeds max length (12)', () => {
    const bad = {
      ...validOutput,
      keywords: {
        ...validOutput.keywords,
        primary: Array.from({ length: 13 }, (_, i) => `kw${i}`),
      },
    };
    expect(() => validateRepoAnalysisOutput(bad)).toThrow();
  });

  it('throws on completely invalid input (string)', () => {
    expect(() => validateRepoAnalysisOutput('not an object')).toThrow();
  });

  it('throws on null', () => {
    expect(() => validateRepoAnalysisOutput(null)).toThrow();
  });
});
