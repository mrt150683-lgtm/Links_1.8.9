-- 041: Self-Evolving Research Agent — Artifacts Table
-- agent_artifacts: agent-specific AI output artifacts (run-level, not entry-level)

CREATE TABLE agent_artifacts (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  run_id          TEXT    REFERENCES agent_runs(id) ON DELETE SET NULL,
  tool_id         TEXT,   -- FK to agent_tools (added in 043); nullable here
  artifact_type   TEXT    NOT NULL CHECK(artifact_type IN (
                    'agent_reflection','agent_surprise','agent_tool_build_report',
                    'agent_tool_test_report','agent_tool_logs','agent_tool_output',
                    'agent_snapshot_report'
                  )),
  model_id        TEXT,
  prompt_id       TEXT,
  prompt_version  TEXT,
  role_hash       TEXT,
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_agent_artifacts_run ON agent_artifacts(run_id);
CREATE INDEX idx_agent_artifacts_pot ON agent_artifacts(pot_id);
CREATE INDEX idx_agent_artifacts_type ON agent_artifacts(artifact_type);
