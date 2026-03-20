-- Migration 0006: Forge Initial Schema
-- Creates forge_runs and forge_packs tables

CREATE TABLE IF NOT EXISTS forge_runs (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  mode TEXT NOT NULL, -- 'repo' | 'idea'
  seed_text TEXT,
  seed_repo_full_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forge_packs (
  pack_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  score REAL NOT NULL,
  repo_ids_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  merge_plan_md TEXT,
  status TEXT NOT NULL, -- 'draft' | 'final'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forge_packs_run_id ON forge_packs(run_id);
