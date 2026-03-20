/**
 * Backoff calculation unit tests
 * Phase 5: Processing Engine
 */

import { describe, it, expect } from 'vitest';
import { calculateBackoff, formatDelay } from '../src/backoff.js';

describe('Backoff calculation', () => {
  const now = Date.now();

  it('should calculate exponential backoff', () => {
    // Attempt 1: base delay (1s)
    const delay1 = calculateBackoff(1, now);
    expect(delay1).toBeGreaterThanOrEqual(now + 900); // At least 0.9s (accounting for jitter)
    expect(delay1).toBeLessThanOrEqual(now + 1100); // At most 1.1s

    // Attempt 2: 2s
    const delay2 = calculateBackoff(2, now);
    expect(delay2).toBeGreaterThanOrEqual(now + 1800);
    expect(delay2).toBeLessThanOrEqual(now + 2200);

    // Attempt 3: 4s
    const delay3 = calculateBackoff(3, now);
    expect(delay3).toBeGreaterThanOrEqual(now + 3600);
    expect(delay3).toBeLessThanOrEqual(now + 4400);

    // Attempt 4: 8s
    const delay4 = calculateBackoff(4, now);
    expect(delay4).toBeGreaterThanOrEqual(now + 7200);
    expect(delay4).toBeLessThanOrEqual(now + 8800);
  });

  it('should cap at max delay', () => {
    // With default max (30 minutes), very high attempt should cap
    const maxDelayMs = 30 * 60 * 1000; // 30 minutes
    const delay = calculateBackoff(20, now); // Would be huge without cap

    expect(delay).toBeLessThanOrEqual(now + maxDelayMs * 1.1); // Max + jitter
  });

  it('should apply jitter within bounds', () => {
    // Run multiple times to verify jitter is random
    const delays = Array.from({ length: 10 }, () => calculateBackoff(2, now));

    // All delays should be different (with very high probability)
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(5); // At least half should be unique

    // All delays should be within jitter bounds (2s ± 10%)
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(now + 1800);
      expect(delay).toBeLessThanOrEqual(now + 2200);
    }
  });

  it('should accept custom config', () => {
    const customDelay = calculateBackoff(1, now, {
      baseDelayMs: 5000, // 5s
      maxDelayMs: 60000, // 1 minute
      multiplier: 3,
      jitterFactor: 0.2, // ±20%
    });

    // Base: 5s, jitter: ±20% = 4s to 6s
    expect(customDelay).toBeGreaterThanOrEqual(now + 4000);
    expect(customDelay).toBeLessThanOrEqual(now + 6000);
  });

  it('should never return negative delay', () => {
    // Even with jitter, delay should never go negative
    const delay = calculateBackoff(1, now, {
      baseDelayMs: 10,
      jitterFactor: 0.5, // Large jitter
    });

    expect(delay).toBeGreaterThanOrEqual(now);
  });
});

describe('formatDelay', () => {
  it('should format milliseconds', () => {
    expect(formatDelay(500)).toBe('500ms');
    expect(formatDelay(999)).toBe('999ms');
  });

  it('should format seconds', () => {
    expect(formatDelay(1000)).toBe('1.0s');
    expect(formatDelay(2500)).toBe('2.5s');
    expect(formatDelay(30000)).toBe('30.0s');
  });

  it('should format minutes', () => {
    expect(formatDelay(60000)).toBe('1.0m');
    expect(formatDelay(150000)).toBe('2.5m');
    expect(formatDelay(1800000)).toBe('30.0m');
  });
});
