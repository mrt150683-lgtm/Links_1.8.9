-- Migration 0003: Repos, readmes, and github_queries tables

CREATE TABLE IF NOT EXISTS github_queries (
  query_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  pass INTEGER NOT NULL DEFAULT 1,
  query_string TEXT NOT NULL,
  params_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_queries_run_id ON github_queries(run_id, pass);

CREATE TABLE IF NOT EXISTS repos (
  repo_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  topics_json TEXT,
  language TEXT,
  license TEXT,
  pushed_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  fork INTEGER NOT NULL DEFAULT 0,
  last_seen_run_id TEXT REFERENCES runs(run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_full_name ON repos(full_name);

CREATE TABLE IF NOT EXISTS repo_query_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repos(repo_id),
  query_id TEXT NOT NULL REFERENCES github_queries(query_id),
  search_rank INTEGER,
  pass_number INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_repo_query_links_repo_id ON repo_query_links(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_query_links_query_id ON repo_query_links(query_id);

CREATE TABLE IF NOT EXISTS readmes (
  readme_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(repo_id),
  sha256 TEXT NOT NULL,
  content_text TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  etag TEXT,
  source_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_readmes_repo_id ON readmes(repo_id);
