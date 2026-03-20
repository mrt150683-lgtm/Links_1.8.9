-- DYK Engine (030_dyk)
-- "Did You Know" micro-insight tables, per-pot onboarding, and pots table rebuild.
-- PRAGMA foreign_keys = OFF required because we rebuild pots table to add 3 new columns.
-- The migration runner detects this and runs outside a transaction.

PRAGMA foreign_keys = OFF;

-- ============================================================
-- 1. Rebuild pots table to add DYK columns
--    (SQLite can't ALTER CHECK constraints via ADD COLUMN;
--     goal_text, search_targets_json, dyk_state_json are nullable so safe to add)
-- ============================================================

-- Actually SQLite can ADD COLUMN for nullable columns without default CHECK issues.
-- Use ALTER TABLE ADD COLUMN here (simpler than rebuild).

ALTER TABLE pots ADD COLUMN goal_text TEXT;
ALTER TABLE pots ADD COLUMN search_targets_json TEXT;
ALTER TABLE pots ADD COLUMN dyk_state_json TEXT;

-- ============================================================
-- 2. dyk_items — stores every generated micro-insight
-- ============================================================
CREATE TABLE IF NOT EXISTS dyk_items (
  id                TEXT    PRIMARY KEY NOT NULL,
  pot_id            TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  entry_id          TEXT    NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  title             TEXT    NOT NULL,
  body              TEXT    NOT NULL,
  keywords_json     TEXT    NOT NULL DEFAULT '[]',
  confidence        REAL    NOT NULL DEFAULT 0.5,
  novelty           REAL    NOT NULL DEFAULT 0.5,
  source_type       TEXT    NOT NULL CHECK(source_type IN (
                      'entry_summary','entry_entities','entry_tags',
                      'intel_answer','deep_research','idle_sweep','manual'
                    )),
  status            TEXT    NOT NULL DEFAULT 'new' CHECK(status IN (
                      'new','queued','shown','known','interested',
                      'snoozed','useless','archived'
                    )),
  shown_count       INTEGER NOT NULL DEFAULT 0,
  signature         TEXT    NOT NULL,
  model_id          TEXT    NOT NULL,
  prompt_id         TEXT    NOT NULL,
  prompt_version    TEXT    NOT NULL,
  role_hash         TEXT,
  evidence_json     TEXT,
  next_eligible_at  INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dyk_items_signature
  ON dyk_items(pot_id, signature);

CREATE INDEX IF NOT EXISTS idx_dyk_items_eligible
  ON dyk_items(pot_id, status, next_eligible_at);

CREATE INDEX IF NOT EXISTS idx_dyk_items_created
  ON dyk_items(pot_id, created_at DESC);

-- ============================================================
-- 3. dyk_feedback_events — append-only feedback trail
-- ============================================================
CREATE TABLE IF NOT EXISTS dyk_feedback_events (
  id            TEXT    PRIMARY KEY NOT NULL,
  dyk_id        TEXT    NOT NULL REFERENCES dyk_items(id) ON DELETE CASCADE,
  pot_id        TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  action        TEXT    NOT NULL CHECK(action IN (
                  'known','interested','snooze','useless',
                  'opened_chat','opened_search'
                )),
  snooze_hours  INTEGER,
  engine_id     TEXT,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_dyk_feedback_dyk_id
  ON dyk_feedback_events(dyk_id);

-- ============================================================
-- 4. dyk_notifications — per-pot inbox rows
-- ============================================================
CREATE TABLE IF NOT EXISTS dyk_notifications (
  id          TEXT    PRIMARY KEY NOT NULL,
  pot_id      TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  dyk_id      TEXT    NOT NULL REFERENCES dyk_items(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','dismissed')),
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_dyk_notifications_pot_status
  ON dyk_notifications(pot_id, status, created_at DESC);

-- ============================================================
-- 5. pot_onboarding — per-pot setup wizard state
-- ============================================================
CREATE TABLE IF NOT EXISTS pot_onboarding (
  id                  TEXT    PRIMARY KEY NOT NULL,
  pot_id              TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  completed_at        INTEGER,
  goal_text           TEXT,
  role_ref            TEXT,
  search_targets_json TEXT    NOT NULL DEFAULT '[]',
  state_json          TEXT    NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pot_onboarding_pot_id
  ON pot_onboarding(pot_id);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
