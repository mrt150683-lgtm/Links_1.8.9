/**
 * cronUtils unit tests
 * Tests for computeTaskNextRunAt and parseCronLikeDescription
 */

import { describe, it, expect } from 'vitest';
import { computeTaskNextRunAt, parseCronLikeDescription } from '../src/lib/cronUtils.js';

// Fixed reference times (UTC) — Jan 2024, verified weekdays
// new Date('2024-01-15').getDay() === 1 (Monday)
// new Date('2024-01-16').getDay() === 2 (Tuesday)
// new Date('2024-01-22').getDay() === 1 (Monday)

const MON_0800_UTC = new Date('2024-01-15T08:00:00Z').getTime(); // Monday Jan 15 2024 08:00 UTC
const MON_1000_UTC = new Date('2024-01-15T10:00:00Z').getTime(); // Monday Jan 15 2024 10:00 UTC
const TUE_0700_UTC = new Date('2024-01-16T07:00:00Z').getTime(); // Tuesday Jan 16 2024 07:00 UTC

describe('computeTaskNextRunAt', () => {
  it('null input → null', () => {
    expect(computeTaskNextRunAt(null, 'UTC', Date.now())).toBeNull();
  });

  it('undefined input → null', () => {
    expect(computeTaskNextRunAt(undefined, 'UTC', Date.now())).toBeNull();
  });

  it('@once → null', () => {
    expect(computeTaskNextRunAt('@once', 'UTC', Date.now())).toBeNull();
  });

  it('@interval 2h → fromMs + 7_200_000', () => {
    expect(computeTaskNextRunAt('@interval 2h', 'UTC', 1_000_000)).toBe(1_000_000 + 7_200_000);
  });

  it('@interval 30m → fromMs + 1_800_000', () => {
    expect(computeTaskNextRunAt('@interval 30m', 'UTC', 1_000_000)).toBe(1_000_000 + 1_800_000);
  });

  it('daily at 09:00 (before target) → same day 09:00', () => {
    // Mon 08:00 UTC → same day Mon 09:00 UTC
    const expected = new Date('2024-01-15T09:00:00Z').getTime();
    expect(computeTaskNextRunAt('daily at 09:00', 'UTC', MON_0800_UTC)).toBe(expected);
  });

  it('daily at 09:00 (after target) → next day 09:00', () => {
    // Mon 10:00 UTC → Tue 09:00 UTC
    const expected = new Date('2024-01-16T09:00:00Z').getTime();
    expect(computeTaskNextRunAt('daily at 09:00', 'UTC', MON_1000_UTC)).toBe(expected);
  });

  it('weekly on MON at 08:00 from Tuesday 07:00 → next Monday 08:00', () => {
    // Tue Jan16 07:00 UTC → Mon Jan22 08:00 UTC (6 days ahead)
    const expected = new Date('2024-01-22T08:00:00Z').getTime();
    expect(computeTaskNextRunAt('weekly on MON at 08:00', 'UTC', TUE_0700_UTC)).toBe(expected);
  });

  it('weekly on TUE at 09:00 from Monday 08:00 → next Tuesday 09:00', () => {
    // Mon Jan15 08:00 UTC → Tue Jan16 09:00 UTC (1 day ahead)
    const expected = new Date('2024-01-16T09:00:00Z').getTime();
    expect(computeTaskNextRunAt('weekly on TUE at 09:00', 'UTC', MON_0800_UTC)).toBe(expected);
  });
});

describe('parseCronLikeDescription', () => {
  it('null → "Manual"', () => {
    expect(parseCronLikeDescription(null)).toBe('Manual');
  });

  it('undefined → "Manual"', () => {
    expect(parseCronLikeDescription(undefined)).toBe('Manual');
  });

  it('@once → "One time"', () => {
    expect(parseCronLikeDescription('@once')).toBe('One time');
  });

  it('daily at 09:00 → "Daily at 9:00 AM"', () => {
    expect(parseCronLikeDescription('daily at 09:00')).toBe('Daily at 9:00 AM');
  });

  it('daily at 14:30 → "Daily at 2:30 PM"', () => {
    expect(parseCronLikeDescription('daily at 14:30')).toBe('Daily at 2:30 PM');
  });

  it('weekly on MON at 08:00 → "Weekly on Monday at 8:00 AM"', () => {
    expect(parseCronLikeDescription('weekly on MON at 08:00')).toBe('Weekly on Monday at 8:00 AM');
  });

  it('@interval 2h → "Every 2 hours"', () => {
    expect(parseCronLikeDescription('@interval 2h')).toBe('Every 2 hours');
  });

  it('@interval 1h → "Every 1 hour"', () => {
    expect(parseCronLikeDescription('@interval 1h')).toBe('Every 1 hour');
  });

  it('unknown format → passthrough', () => {
    expect(parseCronLikeDescription('custom-format')).toBe('custom-format');
  });
});
