-- 043: Self-Evolving Research Agent — Tool Builder
-- agent_tools, agent_tool_versions, agent_tool_runs

CREATE TABLE agent_tools (
  id                          TEXT    PRIMARY KEY NOT NULL,
  pot_id                      TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  tool_key                    TEXT    NOT NULL,
  name                        TEXT    NOT NULL,
  description                 TEXT    NOT NULL DEFAULT '',
  language                    TEXT    NOT NULL DEFAULT 'javascript' CHECK(language IN ('python','javascript')),
  status                      TEXT    NOT NULL DEFAULT 'draft' CHECK(status IN (
                                'draft','testing','awaiting_approval','active',
                                'disabled','rejected','archived'
                              )),
  version                     INTEGER NOT NULL DEFAULT 1,
  parent_tool_id              TEXT    REFERENCES agent_tools(id) ON DELETE SET NULL,
  bundle_hash                 TEXT,
  encrypted_bundle_path       TEXT,
  manifest_json               TEXT    NOT NULL DEFAULT '{}',
  input_schema_json           TEXT    NOT NULL DEFAULT '{}',
  output_schema_json          TEXT    NOT NULL DEFAULT '{}',
  capabilities_required_json  TEXT    NOT NULL DEFAULT '[]',
  sandbox_policy_json         TEXT    NOT NULL DEFAULT '{}',
  network_policy              TEXT    NOT NULL DEFAULT 'none' CHECK(network_policy IN ('none','approved_wrappers')),
  cross_pot_allowed           INTEGER NOT NULL DEFAULT 0,
  approval_required           INTEGER NOT NULL DEFAULT 1,
  created_by_run_id           TEXT    REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_by_model_id         TEXT,
  prompt_ids_json             TEXT    NOT NULL DEFAULT '[]',
  role_hash                   TEXT,
  source_refs_json            TEXT    NOT NULL DEFAULT '[]',
  test_summary_json           TEXT    NOT NULL DEFAULT 'null',
  last_run_at                 INTEGER,
  last_success_at             INTEGER,
  usage_count                 INTEGER NOT NULL DEFAULT 0,
  average_rating              REAL    NOT NULL DEFAULT 0.0,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_agent_tools_pot_key ON agent_tools(pot_id, tool_key);
CREATE INDEX idx_agent_tools_pot ON agent_tools(pot_id);
CREATE INDEX idx_agent_tools_status ON agent_tools(status);

CREATE TABLE agent_tool_versions (
  id                        TEXT    PRIMARY KEY NOT NULL,
  tool_id                   TEXT    NOT NULL REFERENCES agent_tools(id) ON DELETE CASCADE,
  version                   INTEGER NOT NULL,
  bundle_hash               TEXT,
  encrypted_bundle_path     TEXT,
  manifest_json             TEXT    NOT NULL DEFAULT '{}',
  build_report_artifact_id  TEXT,
  created_at                INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_agent_tool_versions_tool ON agent_tool_versions(tool_id);

CREATE TABLE agent_tool_runs (
  id                  TEXT    PRIMARY KEY NOT NULL,
  pot_id              TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  tool_id             TEXT    NOT NULL REFERENCES agent_tools(id) ON DELETE CASCADE,
  tool_version        INTEGER NOT NULL DEFAULT 1,
  agent_run_id        TEXT    REFERENCES agent_runs(id) ON DELETE SET NULL,
  snapshot_id         TEXT    REFERENCES agent_snapshots(id) ON DELETE SET NULL,
  trigger_type        TEXT    NOT NULL DEFAULT 'manual' CHECK(trigger_type IN ('manual','heartbeat','bold_auto','user_retry')),
  status              TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','cancelled')),
  input_payload_json  TEXT    NOT NULL DEFAULT '{}',
  output_artifact_id  TEXT,
  logs_artifact_id    TEXT,
  budget_usage_json   TEXT    NOT NULL DEFAULT '{}',
  started_at          INTEGER,
  finished_at         INTEGER
) STRICT;

CREATE INDEX idx_agent_tool_runs_tool ON agent_tool_runs(tool_id);
CREATE INDEX idx_agent_tool_runs_pot ON agent_tool_runs(pot_id);
CREATE INDEX idx_agent_tool_runs_status ON agent_tool_runs(status);

-- Backfill FK on agent_artifacts for tool_id now that agent_tools exists
-- (Can't add FK constraint after the fact in SQLite STRICT, so we just rely on app-level enforcement)
