-- 044: Automation & Heartbeat — Per-Pot Automation Settings
-- pot_automation_settings

CREATE TABLE pot_automation_settings (
  id                              TEXT    PRIMARY KEY NOT NULL,
  pot_id                          TEXT    NOT NULL UNIQUE REFERENCES pots(id) ON DELETE CASCADE,
  enabled                         INTEGER NOT NULL DEFAULT 0,
  heartbeat_enabled               INTEGER NOT NULL DEFAULT 0,
  agent_task_management_enabled   INTEGER NOT NULL DEFAULT 0,
  agent_can_create_tasks          INTEGER NOT NULL DEFAULT 0,
  agent_can_update_tasks          INTEGER NOT NULL DEFAULT 0,
  agent_can_complete_tasks        INTEGER NOT NULL DEFAULT 0,
  agent_can_render_heartbeat_md   INTEGER NOT NULL DEFAULT 1,
  default_model                   TEXT,
  timezone                        TEXT    NOT NULL DEFAULT 'UTC',
  quiet_hours_json                TEXT    NOT NULL DEFAULT 'null',
  run_windows_json                TEXT    NOT NULL DEFAULT 'null',
  token_budget_json               TEXT    NOT NULL DEFAULT 'null',
  max_tasks_created_per_day       INTEGER NOT NULL DEFAULT 5,
  max_heartbeat_runs_per_day      INTEGER NOT NULL DEFAULT 4,
  created_at                      INTEGER NOT NULL,
  updated_at                      INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_automation_settings_pot ON pot_automation_settings(pot_id);
