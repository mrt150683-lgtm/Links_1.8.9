-- Migration 021: Deep Research Agent
-- Adds tables for research runs, schedules, notifications, and run-scoped artifacts

-- ============================================================================
-- Research artifacts (run-scoped, unlike derived_artifacts which are entry-scoped)
-- ============================================================================
CREATE TABLE research_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN (
    'research_plan', 'research_report', 'research_delta',
    'research_novelty', 'research_checkpoint'
  )),
  schema_version INTEGER NOT NULL DEFAULT 1,
  model_id TEXT,
  prompt_id TEXT,
  prompt_version TEXT,
  temperature REAL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_research_artifacts_run ON research_artifacts(run_id, artifact_type);

-- ============================================================================
-- Research runs (first-class objects — run instances only, no schedule intent)
-- ============================================================================
CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN (
      'draft','planning','awaiting_approval','queued',
      'running','paused','done','failed','cancelled'
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
  -- checkpoint_json stores IDs + recursion stack ONLY, NOT accumulated_learnings.
  -- accumulated_learnings are stored as a 'research_checkpoint' research_artifact.
  checkpoint_artifact_id TEXT REFERENCES research_artifacts(id),
  checkpoint_json TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}',
  budget_usage_json TEXT NOT NULL DEFAULT '{}',

  -- Lineage
  previous_run_id TEXT REFERENCES research_runs(id),

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

CREATE INDEX idx_research_runs_pot_id ON research_runs(pot_id);
CREATE INDEX idx_research_runs_status ON research_runs(status);

-- ============================================================================
-- Research schedules (first-class; run instances carry no schedule intent)
-- ============================================================================
CREATE TABLE research_schedules (
  id TEXT PRIMARY KEY,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  cron_like TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  goal_prompt TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  last_run_id TEXT REFERENCES research_runs(id),
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_research_schedules_pot ON research_schedules(pot_id);

-- ============================================================================
-- Research run notifications (novelty/contradiction alerts)
-- ============================================================================
CREATE TABLE research_notifications (
  id TEXT PRIMARY KEY,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('novelty_threshold','contradiction_threshold','keyword_match')),
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  read_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_research_notifications_pot ON research_notifications(pot_id, read_at);
