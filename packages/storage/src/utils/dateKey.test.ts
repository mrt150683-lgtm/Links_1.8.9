/**
 * Unit tests for dateKey utility functions.
 */

import { describe, it, expect } from 'vitest';
import { toDateKey, getSystemTimezone, todayDateKey } from './dateKey.js';

describe('toDateKey', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    // 2026-03-04T00:00:00.000Z
    const epochMs = Date.UTC(2026, 2, 4, 0, 0, 0); // month is 0-indexed
    expect(toDateKey(epochMs, 'UTC')).toBe('2026-03-04');
  });

  it('returns YYYY-MM-DD for mid-day UTC', () => {
    // 2026-06-15T12:30:00.000Z
    const epochMs = Date.UTC(2026, 5, 15, 12, 30, 0);
    expect(toDateKey(epochMs, 'UTC')).toBe('2026-06-15');
  });

  it('returns date one day earlier for New York at midnight UTC', () => {
    // Midnight UTC = 7 PM or 8 PM prior day in New York (UTC-5 or -4)
    const epochMs = Date.UTC(2026, 2, 4, 0, 0, 0); // 2026-03-04T00:00:00Z
    const nyKey = toDateKey(epochMs, 'America/New_York');
    // In EST (UTC-5) this is 2026-03-03T19:00:00, so date is 2026-03-03
    expect(nyKey).toBe('2026-03-03');
  });

  it('returns the same date for noon UTC in New York', () => {
    // Noon UTC = 7AM or 8AM in New York, same day
    const epochMs = Date.UTC(2026, 2, 4, 12, 0, 0); // 2026-03-04T12:00:00Z
    expect(toDateKey(epochMs, 'America/New_York')).toBe('2026-03-04');
  });

  it('handles Asia/Tokyo UTC+9 correctly', () => {
    // 2026-03-03T23:00:00Z = 2026-03-04T08:00:00 in Tokyo
    const epochMs = Date.UTC(2026, 2, 3, 23, 0, 0);
    expect(toDateKey(epochMs, 'Asia/Tokyo')).toBe('2026-03-04');
  });

  it('returns padded two-digit month and day', () => {
    const epochMs = Date.UTC(2026, 0, 5, 12, 0, 0); // Jan 5
    expect(toDateKey(epochMs, 'UTC')).toBe('2026-01-05');
  });
});

describe('getSystemTimezone', () => {
  it('returns a non-empty IANA timezone string', () => {
    const tz = getSystemTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    // Basic IANA format: contains '/' or is 'UTC'
    expect(tz === 'UTC' || tz.includes('/')).toBe(true);
  });
});

describe('todayDateKey', () => {
  it('returns today in YYYY-MM-DD format for UTC', () => {
    const today = todayDateKey('UTC');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify it is actually today's date in UTC
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    expect(today).toBe(expected);
  });

  it('returns a valid date key for any supported timezone', () => {
    const key = todayDateKey('America/Los_Angeles');
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
