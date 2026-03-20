-- Migration 0002: HTTP cache + GitHub rate limit snapshots

CREATE TABLE IF NOT EXISTS http_cache (
  cache_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  status INTEGER NOT NULL,
  etag TEXT,
  last_modified TEXT,
  body_blob BLOB,
  fetched_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_http_cache_url ON http_cache(url);

CREATE TABLE IF NOT EXISTS github_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_rate_limits_run_id ON github_rate_limits(run_id);
