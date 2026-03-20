-- 032: Flow runs checkpoint table
-- Tracks the lifecycle of every user-visible processing flow for status dashboards.

CREATE TABLE flow_runs (
  id            TEXT    PRIMARY KEY NOT NULL,
  flow_type     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'started'
                CHECK(status IN ('started','completed','failed','partial')),
  pot_id        TEXT,
  entry_id      TEXT,
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  last_stage    TEXT,
  last_event    TEXT,
  error_summary TEXT,
  FOREIGN KEY (pot_id)   REFERENCES pots(id)    ON DELETE SET NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_flow_runs_status   ON flow_runs(status, started_at DESC);
CREATE INDEX idx_flow_runs_pot_id   ON flow_runs(pot_id);
CREATE INDEX idx_flow_runs_entry_id ON flow_runs(entry_id);

-- main_chat_notifications: ADD COLUMN is safe (no rebuild needed, no CHECK changes)
ALTER TABLE main_chat_notifications ADD COLUMN flow_id TEXT;
CREATE INDEX idx_main_chat_notif_flow_id
  ON main_chat_notifications(flow_id) WHERE flow_id IS NOT NULL;
