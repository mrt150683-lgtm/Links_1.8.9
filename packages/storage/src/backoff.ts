/**
 * Exponential backoff with jitter for job retry scheduling
 * Phase 5: Processing Engine
 */

export interface BackoffConfig {
  baseDelayMs: number; // Initial delay (default: 1000ms = 1s)
  maxDelayMs: number; // Maximum delay cap (default: 1800000ms = 30min)
  multiplier: number; // Exponential multiplier (default: 2)
  jitterFactor: number; // Jitter as fraction of delay (default: 0.1 = ±10%)
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 30 * 60 * 1000, // 30 minutes
  multiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Calculate next run_after timestamp with exponential backoff + jitter
 *
 * Formula: delay = min(base * multiplier^(attempt-1), max) ± jitter
 *
 * @param attempt - Current attempt number (1-based)
 * @param now - Current timestamp (epoch ms)
 * @param config - Optional backoff configuration
 * @returns next run_after timestamp (epoch ms)
 */
export function calculateBackoff(
  attempt: number,
  now: number,
  config: Partial<BackoffConfig> = {},
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Exponential backoff: base * multiplier^(attempt-1)
  const exponentialDelay = cfg.baseDelayMs * Math.pow(cfg.multiplier, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

  // Add jitter: ± (delay * jitterFactor)
  const jitter = cappedDelay * cfg.jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = Math.max(0, cappedDelay + jitter);

  return now + Math.floor(finalDelay);
}

/**
 * Get human-readable delay duration
 *
 * @param delayMs - Delay in milliseconds
 * @returns formatted string (e.g., "2.5s", "1.2m", "30m")
 */
export function formatDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs}ms`;
  }
  if (delayMs < 60000) {
    return `${(delayMs / 1000).toFixed(1)}s`;
  }
  return `${(delayMs / 60000).toFixed(1)}m`;
}
