-- Browser persistence layer (Phase A+)
-- Note: tab_groups created first because browser_tabs references it.

-- Tab groups (Phase C+)
CREATE TABLE IF NOT EXISTS tab_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#4a9eff',
  pot_id     TEXT REFERENCES pots(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- Shelved tabs (Phase B+)
CREATE TABLE IF NOT EXISTS shelf_tabs (
  id             TEXT PRIMARY KEY,
  url            TEXT NOT NULL,
  title          TEXT,
  favicon_url    TEXT,
  group_id       TEXT REFERENCES tab_groups(id) ON DELETE SET NULL,
  note           TEXT,
  shelved_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  last_active_at INTEGER
) STRICT;

-- Named sessions (Phase J+)
CREATE TABLE IF NOT EXISTS browser_sessions (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  tab_snapshot     TEXT NOT NULL DEFAULT '[]',
  shelf_snapshot   TEXT NOT NULL DEFAULT '[]',
  groups_snapshot  TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- Browser history (Phase K+)
CREATE TABLE IF NOT EXISTS browser_history (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  title      TEXT,
  visit_time INTEGER NOT NULL DEFAULT (unixepoch()),
  tab_id     TEXT,
  session_id TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_browser_history_time ON browser_history(visit_time DESC);
CREATE INDEX IF NOT EXISTS idx_browser_history_url ON browser_history(url);
