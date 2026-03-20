-- Migration 022: Deep Research — blocked status + new artifact types
-- Adds 'blocked' to research_runs.status CHECK.
-- Adds 'research_blocked' and 'research_rejection_summary' to research_artifacts.artifact_type CHECK.
--
-- SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT so we must
-- DROP and RE-CREATE the affected tables (same pattern as migration 019).
-- Foreign key and index names are preserved.

PRAGMA foreign_keys = OFF;
BEGIN;

-- ============================================================================
-- research_artifacts — add new artifact types
-- ============================================================================

CREATE TABLE research_artifacts_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN (
    'research_plan', 'research_report', 'research_delta',
    'research_novelty', 'research_checkpoint',
    'research_blocked', 'research_rejection_summary'
  )),
  schema_version INTEGER NOT NULL DEFAULT 1,
  model_id TEXT,
  prompt_id TEXT,
  prompt_version TEXT,
  temperature REAL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

INSERT INTO research_artifacts_new SELECT * FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_new RENAME TO research_artifacts;

CREATE INDEX idx_research_artifacts_run ON research_artifacts(run_id, artifact_type);

-- ============================================================================
-- research_runs — add 'blocked' status
-- ============================================================================

CREATE TABLE research_runs_new (
  id TEXT PRIMARY KEY,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN (
      'draft','planning','awaiting_approval','queued',
      'running','paused','done','failed','cancelled','blocked'
    )),

  -- Goal & config
  goal_prompt TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  selected_model TEXT,
  model_overrides_json TEXT,

  -- Plan
  plan_artifact_id TEXT REFERENCES research_artifacts(id),
  plan_approved_at INTEGER,
  plan_approved_by TEXT DEFAULT 'user',

  -- Execution state
  checkpoint_artifact_id TEXT REFERENCES research_artifacts(id),
  checkpoint_json TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}',
  budget_usage_json TEXT NOT NULL DEFAULT '{}',

  -- Lineage
  previous_run_id TEXT REFERENCES research_runs_new(id),

  -- Provenance
  model_id TEXT,
  prompt_ids_json TEXT,
  entries_read_json TEXT,
  sources_ingested_json TEXT,

  -- Output artifact references
  report_artifact_id TEXT REFERENCES research_artifacts(id),
  delta_artifact_id TEXT REFERENCES research_artifacts(id),
  novelty_artifact_id TEXT REFERENCES research_artifacts(id),

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
) STRICT;

INSERT INTO research_runs_new SELECT * FROM research_runs;
DROP TABLE research_runs;
ALTER TABLE research_runs_new RENAME TO research_runs;

CREATE INDEX idx_research_runs_pot_id ON research_runs(pot_id);
CREATE INDEX idx_research_runs_status ON research_runs(status);

COMMIT;
PRAGMA foreign_keys = ON;
