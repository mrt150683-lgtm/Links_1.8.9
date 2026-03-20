-- Migration 023: Deep Research — search candidates artifact type
-- Adds 'research_search_candidates' to research_artifacts.artifact_type CHECK.
--
-- SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT so we must
-- DROP and RE-CREATE the affected table (same pattern as migration 022).

PRAGMA foreign_keys = OFF;
BEGIN;

-- ============================================================================
-- research_artifacts — add research_search_candidates artifact type
-- ============================================================================

CREATE TABLE research_artifacts_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN (
    'research_plan', 'research_report', 'research_delta',
    'research_novelty', 'research_checkpoint',
    'research_blocked', 'research_rejection_summary',
    'research_search_candidates'
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

COMMIT;
PRAGMA foreign_keys = ON;
