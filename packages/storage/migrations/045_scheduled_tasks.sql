-- 045: Automation & Heartbeat — Scheduled Tasks + Task Runs

CREATE TABLE scheduled_tasks (
  id                    TEXT    PRIMARY KEY NOT NULL,
  pot_id                TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  task_type             TEXT    NOT NULL DEFAULT 'custom_prompt_task',
  title                 TEXT    NOT NULL,
  description           TEXT    NOT NULL DEFAULT '',
  status                TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','canceled')),
  schedule_kind         TEXT    NOT NULL DEFAULT 'manual' CHECK(schedule_kind IN ('cron','once','manual','event')),
  cron_like             TEXT,
  run_at                INTEGER,
  timezone              TEXT    NOT NULL DEFAULT 'UTC',
  payload_json          TEXT    NOT NULL DEFAULT '{}',
  created_by            TEXT    NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','system','agent')),
  created_from          TEXT    NOT NULL DEFAULT 'settings' CHECK(created_from IN ('chat','settings','automation','migration')),
  last_run_at           INTEGER,
  next_run_at           INTEGER,
  last_result_status    TEXT,
  last_result_summary   TEXT,
  priority              INTEGER NOT NULL DEFAULT 10,
  locked_by             TEXT,
  locked_at             INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_scheduled_tasks_pot ON scheduled_tasks(pot_id);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
CREATE INDEX idx_scheduled_tasks_status ON scheduled_tasks(status);

CREATE TABLE task_runs (
  id              TEXT    PRIMARY KEY NOT NULL,
  task_id         TEXT    NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  job_id          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','skipped')),
  started_at      INTEGER,
  finished_at     INTEGER,
  model_id        TEXT,
  prompt_id       TEXT,
  prompt_version  TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_estimate   REAL    NOT NULL DEFAULT 0.0,
  result_json     TEXT    NOT NULL DEFAULT 'null',
  error_text      TEXT,
  created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_task_runs_task ON task_runs(task_id);
CREATE INDEX idx_task_runs_pot ON task_runs(pot_id);
CREATE INDEX idx_task_runs_status ON task_runs(status);
