import { describe, it, expect, vi } from 'vitest';
import { TokenBucketLimiter } from '../../github/throttle.js';

describe('TokenBucketLimiter', () => {
  it('returns 0 wait when tokens are available', () => {
    const now = 0;
    const limiter = new TokenBucketLimiter({ _getNow: () => now });
    // Fresh limiter has full tokens
    const wait = limiter.consume('search');
    expect(wait).toBe(0);
  });

  it('returns wait time when bucket is empty', () => {
    const now = 0;
    const limiter = new TokenBucketLimiter({ _getNow: () => now });
    // Drain all 30 tokens
    for (let i = 0; i < 30; i++) {
      limiter.consume('search');
    }
    // 31st should require waiting
    const wait = limiter.consume('search');
    expect(wait).toBeGreaterThan(0);
  });

  it('calls onThrottle when bucket is empty', () => {
    const onThrottle = vi.fn();
    const now = 0;
    const limiter = new TokenBucketLimiter({ onThrottle, _getNow: () => now });

    // Drain bucket
    for (let i = 0; i < 30; i++) limiter.consume('search');

    limiter.consume('search');
    expect(onThrottle).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'search', reason: 'token_bucket_empty' })
    );
  });

  it('refills tokens over time', () => {
    const clock = { now: 0 };
    const limiter = new TokenBucketLimiter({ _getNow: () => clock.now });

    // Drain all tokens
    for (let i = 0; i < 30; i++) limiter.consume('search');

    // Advance time by 1 minute (should refill ~30 tokens)
    clock.now = 60 * 1000;
    const tokens = limiter.getTokens('search');
    expect(tokens).toBeCloseTo(30, 0);
  });

  it('handleRateLimitResponse uses Retry-After header', () => {
    const onThrottle = vi.fn();
    const now = 0;
    const limiter = new TokenBucketLimiter({ onThrottle, _getNow: () => now });

    const waitMs = limiter.handleRateLimitResponse('search', {
      status: 429,
      retryAfter: '30',
      rateLimitReset: null,
    });

    expect(waitMs).toBe(30_000);
    expect(onThrottle).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'search',
        wait_ms: 30_000,
        reason: 'rate_limit_429',
        status: 429,
      })
    );
  });

  it('handleRateLimitResponse uses X-RateLimit-Reset header', () => {
    const now = Date.now();
    const resetAt = Math.floor(now / 1000) + 45; // 45s from now
    const limiter = new TokenBucketLimiter({ _getNow: () => now });

    const waitMs = limiter.handleRateLimitResponse('core', {
      status: 403,
      retryAfter: null,
      rateLimitReset: String(resetAt),
    });

    // Should be ~45s + 1s buffer
    expect(waitMs).toBeGreaterThan(40_000);
    expect(waitMs).toBeLessThan(60_000);
  });
});
