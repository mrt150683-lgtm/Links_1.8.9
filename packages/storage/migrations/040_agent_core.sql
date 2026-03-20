-- 040: Self-Evolving Research Agent — Core Tables
-- agent_configs, agent_runs, agent_candidates, agent_feedback_events, agent_schedules

CREATE TABLE agent_configs (
  id                              TEXT    PRIMARY KEY NOT NULL,
  pot_id                          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  enabled                         INTEGER NOT NULL DEFAULT 0,
  mode                            TEXT    NOT NULL DEFAULT 'balanced' CHECK(mode IN ('quiet','balanced','bold')),
  goal_text                       TEXT,
  cross_pot_enabled               INTEGER NOT NULL DEFAULT 0,
  delivery_frequency              TEXT    NOT NULL DEFAULT 'daily',
  delivery_time_local             TEXT    NOT NULL DEFAULT '09:00',
  timezone                        TEXT    NOT NULL DEFAULT 'UTC',
  max_surprises_per_day           INTEGER NOT NULL DEFAULT 1,
  allow_tool_building             INTEGER NOT NULL DEFAULT 0,
  allow_auto_test_low_risk_tools  INTEGER NOT NULL DEFAULT 0,
  allow_auto_run_low_risk_tools   INTEGER NOT NULL DEFAULT 0,
  quiet_hours_json                TEXT    NOT NULL DEFAULT 'null',
  created_at                      INTEGER NOT NULL,
  updated_at                      INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_agent_configs_pot ON agent_configs(pot_id);

CREATE TABLE agent_runs (
  id                      TEXT    PRIMARY KEY NOT NULL,
  pot_id                  TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  run_type                TEXT    NOT NULL CHECK(run_type IN ('heartbeat','manual','tool_build','tool_test','tool_run','cross_pot_bridge')),
  status                  TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','done','failed','cancelled')),
  schedule_id             TEXT,
  snapshot_id             TEXT,
  selected_candidate_id   TEXT,
  budget_usage_json       TEXT    NOT NULL DEFAULT '{}',
  progress_json           TEXT    NOT NULL DEFAULT '{}',
  model_id                TEXT,
  prompt_ids_json         TEXT    NOT NULL DEFAULT '[]',
  role_hash               TEXT,
  created_at              INTEGER NOT NULL,
  started_at              INTEGER,
  finished_at             INTEGER
) STRICT;

CREATE INDEX idx_agent_runs_pot ON agent_runs(pot_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_created ON agent_runs(created_at DESC);

CREATE TABLE agent_candidates (
  id                  TEXT    PRIMARY KEY NOT NULL,
  pot_id              TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  run_id              TEXT    REFERENCES agent_runs(id) ON DELETE SET NULL,
  candidate_type      TEXT    NOT NULL CHECK(candidate_type IN (
                        'insight','lead','contradiction','foreign_language_finding',
                        'next_action','tool_offer','chat_seed','search_prompt',
                        'nutrition_correlation','research_novelty','journal_theme'
                      )),
  title               TEXT    NOT NULL,
  body                TEXT    NOT NULL,
  confidence          REAL    NOT NULL DEFAULT 0.5,
  novelty             REAL    NOT NULL DEFAULT 0.5,
  relevance           REAL    NOT NULL DEFAULT 0.5,
  evidence_score      REAL    NOT NULL DEFAULT 0.5,
  cost_score          REAL    NOT NULL DEFAULT 0.5,
  fatigue_score       REAL    NOT NULL DEFAULT 0.0,
  final_score         REAL    NOT NULL DEFAULT 0.0,
  status              TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN (
                        'pending','selected','delivered','snoozed','archived','rejected'
                      )),
  signature           TEXT    NOT NULL,
  source_refs_json    TEXT    NOT NULL DEFAULT '[]',
  launch_payload_json TEXT    NOT NULL DEFAULT 'null',
  delivered_at        INTEGER,
  next_eligible_at    INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_agent_candidates_pot ON agent_candidates(pot_id);
CREATE INDEX idx_agent_candidates_status ON agent_candidates(status);
CREATE INDEX idx_agent_candidates_score ON agent_candidates(final_score DESC);
CREATE INDEX idx_agent_candidates_run ON agent_candidates(run_id);

CREATE TABLE agent_feedback_events (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  candidate_id    TEXT    NOT NULL REFERENCES agent_candidates(id) ON DELETE CASCADE,
  action          TEXT    NOT NULL CHECK(action IN (
                    'cool','meh','undo','known','interested','snooze','useless',
                    'approved_tool','rejected_tool','ran_tool','disabled_tool',
                    'opened_chat','opened_search'
                  )),
  metadata_json   TEXT    NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_agent_feedback_pot ON agent_feedback_events(pot_id);
CREATE INDEX idx_agent_feedback_candidate ON agent_feedback_events(candidate_id);
CREATE INDEX idx_agent_feedback_created ON agent_feedback_events(created_at DESC);

CREATE TABLE agent_schedules (
  id          TEXT    PRIMARY KEY NOT NULL,
  pot_id      TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  cron_like   TEXT,
  timezone    TEXT    NOT NULL DEFAULT 'UTC',
  last_run_id TEXT,
  next_run_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_agent_schedules_pot ON agent_schedules(pot_id);
CREATE INDEX idx_agent_schedules_next_run ON agent_schedules(next_run_at);
