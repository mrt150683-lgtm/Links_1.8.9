import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitHubClient, GitHubRateLimitError } from '../../github/client.js';
import { openDb, closeDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { HttpCacheDao, makeCacheKey } from '../../db/dao/http_cache.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Db } from '../../db/index.js';

function makeTempDb(): { db: Db; dbPath: string } {
  const dbPath = path.join(
    os.tmpdir(),
    `scout-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = openDb({ path: dbPath });
  runMigrations(db);
  return { db, dbPath };
}

function makeMockFetch(responses: Array<{
  status: number;
  body?: string;
  headers?: Record<string, string>;
}>): typeof fetch {
  let call = 0;
  return (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const resp = responses[call % responses.length];
    if (resp === undefined) throw new Error('No more mock responses');
    call++;
    const headersMap = new Map(Object.entries(resp.headers ?? {}));
    return Promise.resolve({
      status: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      headers: {
        get: (key: string) => headersMap.get(key.toLowerCase()) ?? null,
      },
      text: () => Promise.resolve(resp.body ?? ''),
      json: () => Promise.resolve(resp.body ? JSON.parse(resp.body) : null),
    } as unknown as Response);
  };
}

describe('GitHubClient caching', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('stores ETag from first 200 response', async () => {
    const mockFetch = makeMockFetch([
      {
        status: 200,
        body: JSON.stringify({ rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 }, resources: { core: { limit: 5000, remaining: 4999, reset: 0, used: 1 }, search: { limit: 30, remaining: 29, reset: 0, used: 1 } } }),
        headers: { etag: '"abc123"' },
      },
    ]);

    const client = new GitHubClient({ token: 'test-token', db, _fetch: mockFetch });
    const resp = await client.getRateLimit();

    expect(resp.status).toBe(200);
    expect(resp.fromCache).toBe(false);

    const cacheDao = new HttpCacheDao(db);
    const key = makeCacheKey('GET', 'https://api.github.com/rate_limit', 'application/vnd.github+json');
    const cached = cacheDao.get(key);
    expect(cached).not.toBeNull();
    expect(cached?.etag).toBe('"abc123"');
  });

  it('returns cached body on 304 Not Modified', async () => {
    const bodyJson = JSON.stringify({ rate: { limit: 5000, remaining: 4000, reset: 0, used: 1000 }, resources: { core: { limit: 5000, remaining: 4000, reset: 0, used: 1000 }, search: { limit: 30, remaining: 25, reset: 0, used: 5 } } });

    const mockFetch = makeMockFetch([
      // First request: 200 with etag
      { status: 200, body: bodyJson, headers: { etag: '"etag1"' } },
      // Second request: 304
      { status: 304, body: '', headers: {} },
    ]);

    const client = new GitHubClient({ token: 'test-token', db, _fetch: mockFetch });

    // First call
    const resp1 = await client.getRateLimit();
    expect(resp1.fromCache).toBe(false);

    // Second call should use cache
    const resp2 = await client.getRateLimit();
    expect(resp2.fromCache).toBe(true);
    expect(resp2.status).toBe(200);
    // Data should match cached body
    expect(resp2.data).toBeTruthy();
  });

  it('sends If-None-Match on second request when etag is cached', async () => {
    const capturedHeaders: Record<string, string>[] = [];

    const mockFetch = ((_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedHeaders.push((init?.headers as Record<string, string>) ?? {});
      const call = capturedHeaders.length;
      if (call === 1) {
        return Promise.resolve({
          status: 200,
          ok: true,
          headers: { get: (k: string) => k === 'etag' ? '"etag-value"' : null },
          text: () => Promise.resolve('{}'),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 304,
        ok: false,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      } as unknown as Response);
    }) as typeof fetch;

    const client = new GitHubClient({ token: 'test-token', db, _fetch: mockFetch });
    await client.request({ path: '/rate_limit' });
    await client.request({ path: '/rate_limit' });

    expect(capturedHeaders[1]?.['If-None-Match']).toBe('"etag-value"');
  });
});

describe('GitHubClient rate limiting', () => {
  let db: Db;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTempDb());
  });

  afterEach(() => {
    closeDb(db);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    vi.useRealTimers();
  });

  it('calls onThrottle when 429 received and retries', async () => {
    vi.useFakeTimers();
    const throttleEvents: unknown[] = [];

    const mockFetch = makeMockFetch([
      { status: 429, body: '', headers: { 'retry-after': '1' } },
      { status: 200, body: '{}', headers: {} },
    ]);

    const client = new GitHubClient({
      token: 'test-token',
      db,
      _fetch: mockFetch,
      onThrottle: (evt) => throttleEvents.push(evt),
    });

    const requestPromise = client.request({ path: '/rate_limit' });
    await vi.runAllTimersAsync();
    await requestPromise;

    expect(throttleEvents.length).toBeGreaterThan(0);
    const evt = throttleEvents[0] as { reason: string; wait_ms: number };
    expect(evt.reason).toBe('rate_limit_429');
    expect(evt.wait_ms).toBe(1000); // Retry-After: 1 → 1000ms
  });

  it('throws GitHubRateLimitError after max retries', async () => {
    vi.useFakeTimers();

    const mockFetch = makeMockFetch([
      { status: 429, body: '', headers: { 'retry-after': '1' } },
      { status: 429, body: '', headers: { 'retry-after': '1' } },
      { status: 429, body: '', headers: { 'retry-after': '1' } },
    ]);

    const client = new GitHubClient({ token: 'test-token', db, _fetch: mockFetch });

    const requestPromise = client.request({ path: '/rate_limit' });
    // Attach rejection handler immediately before advancing timers
    const assertionPromise = expect(requestPromise).rejects.toBeInstanceOf(GitHubRateLimitError);
    await vi.runAllTimersAsync();
    await assertionPromise;
  });
});
