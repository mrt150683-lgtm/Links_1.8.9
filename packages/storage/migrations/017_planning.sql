-- Migration 017: Project Planning Generator

PRAGMA foreign_keys = ON;

CREATE TABLE planning_runs (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  project_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'questions_generated',
    'answers_recorded',
    'plan_generated',
    'approved',
    'rejected',
    'phases_generated',
    'docs_generated',
    'exported',
    'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 1,
  approved_at INTEGER,
  rejected_reason TEXT,
  model_profile_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_planning_runs_pot_created
  ON planning_runs(pot_id, created_at DESC);

CREATE INDEX idx_planning_runs_status_created
  ON planning_runs(status, created_at DESC);

CREATE TABLE planning_answers (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_planning_answers_run_created
  ON planning_answers(run_id, created_at DESC);

CREATE TABLE planning_files (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_text TEXT,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  sha256 TEXT NOT NULL,
  model_id TEXT,
  prompt_id TEXT,
  prompt_version TEXT,
  temperature REAL,
  max_tokens INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_planning_files_run_revision_path
  ON planning_files(run_id, revision, path);

CREATE INDEX idx_planning_files_run_revision_kind
  ON planning_files(run_id, revision, kind, created_at DESC);
