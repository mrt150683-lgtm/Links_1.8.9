-- Calendar feature (029_calendar)
-- Uses PRAGMA foreign_keys = OFF to rebuild derived_artifacts with new constraint.
-- The migration runner detects this and runs outside a transaction.

PRAGMA foreign_keys = OFF;

-- ============================================================
-- 1. Rebuild derived_artifacts to add 'date_mentions' to CHECK
-- ============================================================
CREATE TABLE derived_artifacts_new (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  entry_id        TEXT    NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  artifact_type   TEXT    NOT NULL CHECK(
    artifact_type IN ('tags','entities','summary','extracted_text','date_mentions')
  ),
  schema_version  INTEGER NOT NULL DEFAULT 1,
  model_id        TEXT    NOT NULL,
  prompt_id       TEXT    NOT NULL,
  prompt_version  TEXT    NOT NULL,
  temperature     REAL    NOT NULL,
  max_tokens      INTEGER,
  created_at      INTEGER NOT NULL,
  role_hash       TEXT,
  payload_json    TEXT    NOT NULL,
  evidence_json   TEXT,
  UNIQUE(entry_id, artifact_type, prompt_id, prompt_version)
) STRICT;

INSERT INTO derived_artifacts_new SELECT * FROM derived_artifacts;
DROP TABLE derived_artifacts;
ALTER TABLE derived_artifacts_new RENAME TO derived_artifacts;

CREATE INDEX IF NOT EXISTS idx_artifacts_entry_type_created
  ON derived_artifacts(entry_id, artifact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_pot_type_created
  ON derived_artifacts(pot_id, artifact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_type_created
  ON derived_artifacts(artifact_type, created_at DESC);

-- ============================================================
-- 2. Add date_key column to browser_history
-- ============================================================
ALTER TABLE browser_history ADD COLUMN date_key TEXT;

CREATE INDEX IF NOT EXISTS idx_browser_history_date_key
  ON browser_history(date_key) WHERE date_key IS NOT NULL;

-- ============================================================
-- 3. calendar_events (manual user-created events)
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT    PRIMARY KEY NOT NULL,
  pot_id      TEXT    REFERENCES pots(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  details     TEXT,
  start_at    INTEGER NOT NULL,
  end_at      INTEGER,
  all_day     INTEGER NOT NULL DEFAULT 0,
  importance  INTEGER NOT NULL DEFAULT 1,
  date_key    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_date_key
  ON calendar_events(date_key);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at
  ON calendar_events(start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_pot_id
  ON calendar_events(pot_id) WHERE pot_id IS NOT NULL;

-- ============================================================
-- 4. calendar_entry_dates (auto-linked signals: capture_date + extracted_date)
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_entry_dates (
  id           TEXT  PRIMARY KEY NOT NULL,
  entry_id     TEXT  NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  pot_id       TEXT  NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  date_key     TEXT  NOT NULL,
  source_kind  TEXT  NOT NULL CHECK(source_kind IN ('capture_date','extracted_date')),
  label        TEXT,
  confidence   REAL,
  artifact_id  TEXT,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_entry_dates_unique
  ON calendar_entry_dates(entry_id, date_key, source_kind);
CREATE INDEX IF NOT EXISTS idx_calendar_entry_dates_date_key
  ON calendar_entry_dates(date_key);
CREATE INDEX IF NOT EXISTS idx_calendar_entry_dates_pot_date
  ON calendar_entry_dates(pot_id, date_key);

-- ============================================================
-- 5. calendar_event_links (manual event <-> entry)
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_event_links (
  id          TEXT    PRIMARY KEY NOT NULL,
  event_id    TEXT    NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  entry_id    TEXT    NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_links_unique
  ON calendar_event_links(event_id, entry_id);

-- ============================================================
-- 6. calendar_notifications (1-per-day enforcement via UNIQUE date_key)
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_notifications (
  id          TEXT    PRIMARY KEY NOT NULL,
  date_key    TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  item_type   TEXT    NOT NULL CHECK(item_type IN ('event','entry_date')),
  item_id     TEXT    NOT NULL,
  shown_at    INTEGER,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_notifications_date_key
  ON calendar_notifications(date_key);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
