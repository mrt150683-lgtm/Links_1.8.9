/**
 * Token bucket rate limiter with two buckets:
 * - "search": 30 requests/minute (GitHub search API hard cap)
 * - "core": 5000 requests/hour (GitHub REST API)
 */

export type BucketName = 'search' | 'core';

export interface BucketConfig {
  maxTokens: number;
  refillRatePerMs: number; // tokens per millisecond
}

const DEFAULT_CONFIGS: Record<BucketName, BucketConfig> = {
  search: {
    maxTokens: 30,
    refillRatePerMs: 30 / (60 * 1000), // 30 per minute
  },
  core: {
    maxTokens: 5000,
    refillRatePerMs: 5000 / (60 * 60 * 1000), // 5000 per hour
  },
};

export interface ThrottleEvent {
  bucket: BucketName;
  wait_ms: number;
  reason: string;
  status?: number;
  reset_at?: string;
}

export type OnThrottle = (event: ThrottleEvent) => void;

export class TokenBucketLimiter {
  private tokens: Record<BucketName, number>;
  private lastRefill: Record<BucketName, number>;
  private readonly configs: Record<BucketName, BucketConfig>;
  private readonly onThrottle: OnThrottle | null;
  private readonly _getNow: () => number;

  constructor(opts: {
    configs?: Partial<Record<BucketName, BucketConfig>>;
    onThrottle?: OnThrottle;
    _getNow?: () => number;
  } = {}) {
    this.configs = {
      search: { ...DEFAULT_CONFIGS.search, ...(opts.configs?.search ?? {}) },
      core: { ...DEFAULT_CONFIGS.core, ...(opts.configs?.core ?? {}) },
    };
    this.onThrottle = opts.onThrottle ?? null;
    this._getNow = opts._getNow ?? (() => Date.now());

    const now = this._getNow();
    this.tokens = {
      search: this.configs.search.maxTokens,
      core: this.configs.core.maxTokens,
    };
    this.lastRefill = { search: now, core: now };
  }

  private refill(bucket: BucketName): void {
    const now = this._getNow();
    const config = this.configs[bucket];
    const elapsed = now - this.lastRefill[bucket];
    const newTokens = elapsed * config.refillRatePerMs;
    this.tokens[bucket] = Math.min(config.maxTokens, this.tokens[bucket] + newTokens);
    this.lastRefill[bucket] = now;
  }

  /**
   * Consume a token from the bucket. Returns the number of milliseconds
   * to wait before the request should be made (0 = no wait needed).
   */
  consume(bucket: BucketName): number {
    this.refill(bucket);

    if (this.tokens[bucket] >= 1) {
      this.tokens[bucket] -= 1;
      return 0;
    }

    // Calculate wait time until we have 1 token
    const config = this.configs[bucket];
    const tokensNeeded = 1 - this.tokens[bucket];
    const waitMs = Math.ceil(tokensNeeded / config.refillRatePerMs);

    if (this.onThrottle) {
      this.onThrottle({
        bucket,
        wait_ms: waitMs,
        reason: 'token_bucket_empty',
      });
    }

    return waitMs;
  }

  /**
   * Wait asynchronously until a token is available.
   */
  async waitForToken(bucket: BucketName): Promise<void> {
    const waitMs = this.consume(bucket);
    if (waitMs > 0) {
      await sleep(waitMs);
      // After sleeping, consume should succeed
      this.tokens[bucket] -= 1;
    }
  }

  /**
   * Handle a rate limit response (403/429) by computing wait time from headers.
   * Returns the ms to wait.
   */
  handleRateLimitResponse(
    bucket: BucketName,
    opts: {
      status: number;
      retryAfter?: string | null;
      rateLimitReset?: string | null;
    }
  ): number {
    const now = this._getNow();
    let waitMs = 60_000; // default 1 minute backoff

    if (opts.retryAfter) {
      const seconds = parseInt(opts.retryAfter, 10);
      if (!isNaN(seconds)) {
        waitMs = seconds * 1000;
      }
    } else if (opts.rateLimitReset) {
      const resetEpoch = parseInt(opts.rateLimitReset, 10);
      if (!isNaN(resetEpoch)) {
        waitMs = Math.max(0, resetEpoch * 1000 - now) + 1000; // +1s buffer
      }
    }

    const reset_at =
      opts.rateLimitReset
        ? new Date(parseInt(opts.rateLimitReset, 10) * 1000).toISOString()
        : new Date(now + waitMs).toISOString();

    if (this.onThrottle) {
      this.onThrottle({
        bucket,
        wait_ms: waitMs,
        reason: opts.status === 429 ? 'rate_limit_429' : 'secondary_rate_limit_403',
        status: opts.status,
        reset_at,
      });
    }

    return waitMs;
  }

  getTokens(bucket: BucketName): number {
    this.refill(bucket);
    return this.tokens[bucket];
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
