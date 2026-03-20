-- 046: Automation & Heartbeat — Heartbeat Snapshots + Documents

CREATE TABLE heartbeat_snapshots (
  id                  TEXT    PRIMARY KEY NOT NULL,
  pot_id              TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  period_key          TEXT    NOT NULL,
  snapshot_json       TEXT    NOT NULL DEFAULT '{}',
  summary_json        TEXT    NOT NULL DEFAULT '{}',
  open_loops_json     TEXT    NOT NULL DEFAULT '[]',
  proposed_tasks_json TEXT    NOT NULL DEFAULT '[]',
  model_id            TEXT,
  prompt_id           TEXT,
  prompt_version      TEXT,
  role_hash           TEXT,
  input_fingerprint   TEXT,
  created_at          INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_heartbeat_snapshots_pot_period ON heartbeat_snapshots(pot_id, period_key);
CREATE INDEX idx_heartbeat_snapshots_pot ON heartbeat_snapshots(pot_id);

CREATE TABLE heartbeat_documents (
  id                      TEXT    PRIMARY KEY NOT NULL,
  pot_id                  TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  heartbeat_snapshot_id   TEXT    NOT NULL REFERENCES heartbeat_snapshots(id) ON DELETE CASCADE,
  format                  TEXT    NOT NULL DEFAULT 'markdown',
  content_text            TEXT    NOT NULL DEFAULT '',
  content_sha256          TEXT,
  storage_mode            TEXT    NOT NULL DEFAULT 'db' CHECK(storage_mode IN ('db','file','both')),
  file_path               TEXT,
  created_at              INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_heartbeat_documents_pot ON heartbeat_documents(pot_id);
CREATE INDEX idx_heartbeat_documents_snapshot ON heartbeat_documents(heartbeat_snapshot_id);
