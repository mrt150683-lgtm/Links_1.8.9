import { createHash } from 'crypto';
import type { Db } from '../index.js';

export interface HttpCacheRow {
  cache_key: string;
  url: string;
  method: string;
  status: number;
  etag: string | null;
  last_modified: string | null;
  body_blob: Buffer | null;
  fetched_at: string;
  expires_at: string | null;
}

export interface CacheLookupResult {
  hit: boolean;
  row: HttpCacheRow | null;
}

export function makeCacheKey(method: string, url: string, accept: string): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${url} accept=${accept}`)
    .digest('hex');
}

export class HttpCacheDao {
  constructor(private readonly db: Db) {}

  get(cacheKey: string): HttpCacheRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM http_cache WHERE cache_key = ?')
        .get(cacheKey) as HttpCacheRow | undefined) ?? null
    );
  }

  upsert(row: HttpCacheRow): void {
    this.db
      .prepare(`
        INSERT INTO http_cache (cache_key, url, method, status, etag, last_modified, body_blob, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          status = excluded.status,
          etag = excluded.etag,
          last_modified = excluded.last_modified,
          body_blob = excluded.body_blob,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at
      `)
      .run(
        row.cache_key,
        row.url,
        row.method,
        row.status,
        row.etag,
        row.last_modified,
        row.body_blob,
        row.fetched_at,
        row.expires_at
      );
  }

  updateFetchedAt(cacheKey: string, fetched_at: string): void {
    this.db
      .prepare('UPDATE http_cache SET fetched_at = ? WHERE cache_key = ?')
      .run(fetched_at, cacheKey);
  }

  prune(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare('DELETE FROM http_cache WHERE fetched_at < ?')
      .run(cutoff);
    return result.changes;
  }
}
