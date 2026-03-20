import { describe, it, expect } from 'vitest';
import { computeFinalScore, computeSignalsBonus, type ScoringPolicy } from '../../llm/scoring.js';

const policy: ScoringPolicy = {
  version: 'v1',
  weights: {
    w1_interestingness: 0.35,
    w2_novelty: 0.25,
    w3_collaboration_potential: 0.35,
    w4_signals_bonus: 0.05,
  },
  signals_bonus: {
    has_integration_surface: 0.5,
    has_api_or_sdk: 0.3,
    no_risk_flags: 0.2,
  },
  thresholds: {
    min_repo_score_for_brief: 0.6,
    min_collaboration_potential_for_brief: 0.65,
    min_brief_score: 0.75,
  },
};

describe('computeSignalsBonus', () => {
  it('returns 0 when no signals present', () => {
    const bonus = computeSignalsBonus({}, policy.signals_bonus);
    expect(bonus).toBe(0);
  });

  it('adds has_integration_surface when surface is non-empty', () => {
    const bonus = computeSignalsBonus({ integration_surface: ['CLI'] }, policy.signals_bonus);
    expect(bonus).toBe(0.5);
  });

  it('adds has_api_or_sdk when surface contains API', () => {
    const bonus = computeSignalsBonus({ integration_surface: ['API', 'CLI'] }, policy.signals_bonus);
    // has_integration_surface (0.5) + has_api_or_sdk (0.3) = 0.8
    expect(bonus).toBe(0.8);
  });

  it('adds has_api_or_sdk when surface contains SDK (case-insensitive)', () => {
    const bonus = computeSignalsBonus({ integration_surface: ['sdk'] }, policy.signals_bonus);
    // has_integration_surface (0.5) + has_api_or_sdk (0.3) = 0.8
    expect(bonus).toBe(0.8);
  });

  it('adds no_risk_flags when risk_flags is empty', () => {
    const bonus = computeSignalsBonus({ risk_flags: [] }, policy.signals_bonus);
    expect(bonus).toBe(0.2);
  });

  it('does NOT add no_risk_flags when risk_flags has items', () => {
    const bonus = computeSignalsBonus({ risk_flags: ['abandoned?'] }, policy.signals_bonus);
    expect(bonus).toBe(0);
  });

  it('returns full 1.0 for all signals present', () => {
    const bonus = computeSignalsBonus(
      { integration_surface: ['API', 'SDK'], risk_flags: [] },
      policy.signals_bonus
    );
    expect(bonus).toBe(1.0);
  });
});

describe('computeFinalScore', () => {
  it('computes exact deterministic score — all high, full bonus', () => {
    const scores = { interestingness: 0.8, novelty: 0.7, collaboration_potential: 0.75 };
    const signals = { integration_surface: ['API', 'SDK'], risk_flags: [] };
    // bonus = 1.0
    // 0.35*0.8 + 0.25*0.7 + 0.35*0.75 + 0.05*1.0
    // = 0.28 + 0.175 + 0.2625 + 0.05 = 0.7675
    const result = computeFinalScore(scores, signals, policy);
    expect(result).toBe(0.7675);
  });

  it('computes exact deterministic score — no bonus', () => {
    const scores = { interestingness: 0.5, novelty: 0.5, collaboration_potential: 0.5 };
    const signals = { integration_surface: [], risk_flags: ['abandoned?'] };
    // bonus = 0
    // 0.35*0.5 + 0.25*0.5 + 0.35*0.5 + 0.05*0 = 0.175 + 0.125 + 0.175 = 0.475
    const result = computeFinalScore(scores, signals, policy);
    expect(result).toBe(0.475);
  });

  it('computes exact deterministic score — partial bonus', () => {
    const scores = { interestingness: 1.0, novelty: 1.0, collaboration_potential: 1.0 };
    const signals = { integration_surface: ['CLI'], risk_flags: [] };
    // bonus = 0.5 (surface) + 0 (no api/sdk) + 0.2 (no risk) = 0.7
    // 0.35*1 + 0.25*1 + 0.35*1 + 0.05*0.7 = 0.35 + 0.25 + 0.35 + 0.035 = 0.985
    const result = computeFinalScore(scores, signals, policy);
    expect(result).toBe(0.985);
  });

  it('clamps at 0 for zero scores and zero bonus', () => {
    const scores = { interestingness: 0, novelty: 0, collaboration_potential: 0 };
    const signals = { risk_flags: ['dead'] };
    const result = computeFinalScore(scores, signals, policy);
    expect(result).toBe(0);
  });

  it('result is rounded to 6 decimal places', () => {
    const scores = { interestingness: 0.333333, novelty: 0.333333, collaboration_potential: 0.333333 };
    const signals = {};
    const result = computeFinalScore(scores, signals, policy);
    // Verify it's a finite number with <= 6 decimal digits
    expect(Number.isFinite(result)).toBe(true);
    expect(result.toString().replace(/^[^.]*\.?/, '').length).toBeLessThanOrEqual(6);
  });
});
