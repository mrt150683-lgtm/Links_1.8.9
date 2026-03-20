import { HttpCacheDao, makeCacheKey, type HttpCacheRow } from '../db/dao/http_cache.js';
import { TokenBucketLimiter, sleep, type BucketName, type OnThrottle } from './throttle.js';
import type { Db } from '../db/index.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const MAX_RETRIES = 3;

export interface GitHubClientOptions {
  token: string;
  db: Db;
  onThrottle?: OnThrottle;
  /** Inject fetch for testing */
  _fetch?: typeof fetch;
  /** Inject clock for testing */
  _getNow?: () => number;
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  headers: {
    etag?: string;
    last_modified?: string;
    rate_limit_remaining?: string;
    rate_limit_reset?: string;
    retry_after?: string;
  };
  fromCache: boolean;
}

export class GitHubClient {
  private readonly token: string;
  private readonly cacheDao: HttpCacheDao;
  private readonly limiter: TokenBucketLimiter;
  private readonly _fetch: typeof fetch;

  constructor(opts: GitHubClientOptions) {
    this.token = opts.token;
    this.cacheDao = new HttpCacheDao(opts.db);
    this._fetch = opts._fetch ?? globalThis.fetch;

    this.limiter = new TokenBucketLimiter({
      onThrottle: opts.onThrottle,
      _getNow: opts._getNow,
    });
  }

  private baseHeaders(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'collaboration-scout/0.1.0',
    };
  }

  async request<T>(opts: {
    path: string;
    accept?: string;
    bucket?: BucketName;
    query?: Record<string, string | number | boolean>;
  }): Promise<GitHubResponse<T>> {
    const accept = opts.accept ?? 'application/vnd.github+json';
    const bucket = opts.bucket ?? 'core';

    // Build URL
    const url = new URL(opts.path.startsWith('http') ? opts.path : `${GITHUB_API_BASE}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const cacheKey = makeCacheKey('GET', url.toString(), accept);
    const cached = this.cacheDao.get(cacheKey);

    // Wait for token
    await this.limiter.waitForToken(bucket);

    // Build headers with conditional request
    const headers: Record<string, string> = this.baseHeaders(accept);
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.last_modified) headers['If-Modified-Since'] = cached.last_modified;

    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      const response = await this._fetch(url.toString(), { method: 'GET', headers });

      const responseHeaders = {
        etag: response.headers.get('etag') ?? undefined,
        last_modified: response.headers.get('last-modified') ?? undefined,
        rate_limit_remaining: response.headers.get('x-ratelimit-remaining') ?? undefined,
        rate_limit_reset: response.headers.get('x-ratelimit-reset') ?? undefined,
        retry_after: response.headers.get('retry-after') ?? undefined,
      };

      // Handle 304 Not Modified
      if (response.status === 304 && cached) {
        this.cacheDao.updateFetchedAt(cacheKey, new Date().toISOString());
        const body = cached.body_blob ? JSON.parse(cached.body_blob.toString('utf-8')) as T : null as T;
        return { status: 200, data: body, headers: responseHeaders, fromCache: true };
      }

      // Handle rate limiting (403/429)
      if (response.status === 429 || response.status === 403) {
        const waitMs = this.limiter.handleRateLimitResponse(bucket, {
          status: response.status,
          retryAfter: responseHeaders.retry_after ?? null,
          rateLimitReset: responseHeaders.rate_limit_reset ?? null,
        });

        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw new GitHubRateLimitError(response.status, waitMs);
        }
        await sleep(waitMs);
        await this.limiter.waitForToken(bucket);
        continue;
      }

      // Handle server errors (5xx) with backoff
      if (response.status >= 500) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw new GitHubServerError(response.status);
        }
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }

      // Success — parse and cache
      if (response.status >= 200 && response.status < 300) {
        const text = await response.text();
        const bodyBuf = Buffer.from(text, 'utf-8');

        const cacheRow: HttpCacheRow = {
          cache_key: cacheKey,
          url: url.toString(),
          method: 'GET',
          status: response.status,
          etag: responseHeaders.etag ?? null,
          last_modified: responseHeaders.last_modified ?? null,
          body_blob: bodyBuf,
          fetched_at: new Date().toISOString(),
          expires_at: null,
        };
        this.cacheDao.upsert(cacheRow);

        let data: T;
        if (!text) {
          data = null as T;
        } else {
          try {
            data = JSON.parse(text) as T;
          } catch {
            // Non-JSON response (e.g., raw README content) — return as-is
            data = text as unknown as T;
          }
        }
        return { status: response.status, data, headers: responseHeaders, fromCache: false };
      }

      // Other errors (404, etc.)
      throw new GitHubApiError(response.status, url.toString());
    }

    throw new GitHubApiError(0, url.toString());
  }

  async getRateLimit(): Promise<GitHubResponse<GitHubRateLimitPayload>> {
    return this.request<GitHubRateLimitPayload>({
      path: '/rate_limit',
      bucket: 'core',
    });
  }
}

export interface GitHubRateLimitPayload {
  resources: {
    core: { limit: number; remaining: number; reset: number; used: number };
    search: { limit: number; remaining: number; reset: number; used: number };
    graphql?: { limit: number; remaining: number; reset: number; used: number };
  };
  rate: { limit: number; remaining: number; reset: number; used: number };
}

export class GitHubApiError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`GitHub API error: ${status} ${url}`);
    this.name = 'GitHubApiError';
  }
}

export class GitHubRateLimitError extends Error {
  constructor(public readonly status: number, public readonly waitMs: number) {
    super(`GitHub rate limit hit (${status}), waited ${waitMs}ms`);
    this.name = 'GitHubRateLimitError';
  }
}

export class GitHubServerError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub server error: ${status}`);
    this.name = 'GitHubServerError';
  }
}
