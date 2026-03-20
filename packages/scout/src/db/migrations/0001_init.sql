-- Migration 0001: Initial schema
-- Creates core tables: meta, runs, run_steps, audit_log

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO meta (key, value, updated_at) VALUES
  ('schema_version', '1', datetime('now')),
  ('app_version', '0.1.0', datetime('now'));

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  args_json TEXT NOT NULL,
  git_sha TEXT,
  config_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  stats_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  run_id TEXT,
  scope TEXT,
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_run_id ON audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event);
