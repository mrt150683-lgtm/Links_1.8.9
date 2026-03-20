import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _scoringDirOverride: string | null = null;

/** Override the scoring directory (for bundled/Electron builds). */
export function setScoringDir(dir: string): void {
  _scoringDirOverride = dir;
}

function resolveScoringPolicyPath(): string {
  const dir = _scoringDirOverride ?? path.resolve(__dirname, '../../scoring');
  return path.join(dir, 'scoring_policy_v1.json');
}

export interface ScoringWeights {
  w1_interestingness: number;
  w2_novelty: number;
  w3_collaboration_potential: number;
  w4_signals_bonus: number;
}

export interface SignalsBonus {
  has_integration_surface: number;
  has_api_or_sdk: number;
  no_risk_flags: number;
}

export interface ScoringThresholds {
  min_repo_score_for_brief: number;
  min_collaboration_potential_for_brief: number;
  min_brief_score: number;
}

export interface ScoringPolicy {
  version: string;
  description?: string;
  weights: ScoringWeights;
  signals_bonus: SignalsBonus;
  thresholds: ScoringThresholds;
}

export function loadScoringPolicy(filePath?: string): ScoringPolicy {
  const target = filePath ?? resolveScoringPolicyPath();
  const raw = readFileSync(target, 'utf-8');
  return JSON.parse(raw) as ScoringPolicy;
}

/**
 * Compute the raw signals bonus value (0 to max possible, not normalized to 0-1).
 * The bonus config values sum to 1.0 (0.5 + 0.3 + 0.2) so the result is already 0-1.
 */
export function computeSignalsBonus(
  signals: { integration_surface?: string[]; risk_flags?: string[] },
  bonusConfig: SignalsBonus
): number {
  let bonus = 0;
  const surface = signals.integration_surface ?? [];

  if (surface.length > 0) {
    bonus += bonusConfig.has_integration_surface;
  }

  if (surface.some((s) => /\bapi\b|\bsdk\b/i.test(s))) {
    bonus += bonusConfig.has_api_or_sdk;
  }

  // Only add no_risk_flags bonus if risk_flags was explicitly set to an empty array.
  // Undefined means the LLM didn't assess risks — we don't reward absence of data.
  if (signals.risk_flags !== undefined && signals.risk_flags.length === 0) {
    bonus += bonusConfig.no_risk_flags;
  }

  return bonus;
}

/**
 * Compute the deterministic final score from LLM scores + signals + scoring policy.
 * Formula: w1*interestingness + w2*novelty + w3*collaboration_potential + w4*signals_bonus
 * Result is rounded to 6 decimal places.
 */
export function computeFinalScore(
  scores: { interestingness: number; novelty: number; collaboration_potential: number },
  signals: { integration_surface?: string[]; risk_flags?: string[] },
  policy: ScoringPolicy
): number {
  const { weights, signals_bonus } = policy;
  const bonus = computeSignalsBonus(signals, signals_bonus);

  const raw =
    weights.w1_interestingness * scores.interestingness +
    weights.w2_novelty * scores.novelty +
    weights.w3_collaboration_potential * scores.collaboration_potential +
    weights.w4_signals_bonus * bonus;

  // Round to 6 decimal places for determinism across floating-point environments
  return Math.round(raw * 1_000_000) / 1_000_000;
}
