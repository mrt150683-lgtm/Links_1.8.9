-- 042: Self-Evolving Research Agent — Snapshot Executor
-- agent_snapshots: temporary read-only DB slices for tool sandbox execution

CREATE TABLE agent_snapshots (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  run_id          TEXT    REFERENCES agent_runs(id) ON DELETE SET NULL,
  scope_json      TEXT    NOT NULL DEFAULT '{}',
  storage_mode    TEXT    NOT NULL DEFAULT 'temp_sqlite' CHECK(storage_mode IN ('temp_sqlite','logical_slice')),
  manifest_json   TEXT    NOT NULL DEFAULT '{}',
  encrypted_path  TEXT,
  status          TEXT    NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','ready','in_use','expired','deleted')),
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  deleted_at      INTEGER
) STRICT;

CREATE INDEX idx_agent_snapshots_pot ON agent_snapshots(pot_id);
CREATE INDEX idx_agent_snapshots_status ON agent_snapshots(status);
CREATE INDEX idx_agent_snapshots_expires ON agent_snapshots(expires_at);
