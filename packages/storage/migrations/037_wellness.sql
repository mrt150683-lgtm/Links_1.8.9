-- 037: Wellness addon — wellbeing logs, supplement catalog, supplement entries, pattern analyses

CREATE TABLE nutrition_wellbeing_logs (
  id            TEXT    PRIMARY KEY NOT NULL,
  pot_id        TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  log_date      TEXT    NOT NULL,   -- YYYY-MM-DD
  symptoms      TEXT    NOT NULL DEFAULT '[]',  -- JSON: ["bloating","fatigue",...]
  mood          INTEGER CHECK(mood BETWEEN 1 AND 5),
  energy        INTEGER CHECK(energy BETWEEN 1 AND 5),
  sleep_quality INTEGER CHECK(sleep_quality BETWEEN 1 AND 5),
  sleep_hours   REAL    CHECK(sleep_hours >= 0 AND sleep_hours <= 24),
  anxiety       INTEGER CHECK(anxiety BETWEEN 1 AND 5),
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(pot_id, log_date)
) STRICT;

CREATE INDEX idx_nutrition_wellbeing_logs_pot_date ON nutrition_wellbeing_logs(pot_id, log_date DESC);

CREATE TABLE nutrition_supplements (
  id           TEXT    PRIMARY KEY NOT NULL,
  pot_id       TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  default_dose REAL,
  dose_unit    TEXT,   -- "mg","g","IU","mcg","ml","capsules","drops"
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_nutrition_supplements_pot ON nutrition_supplements(pot_id, is_active, name);

CREATE TABLE nutrition_supplement_entries (
  id            TEXT    PRIMARY KEY NOT NULL,
  pot_id        TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  supplement_id TEXT    NOT NULL REFERENCES nutrition_supplements(id) ON DELETE CASCADE,
  entry_date    TEXT    NOT NULL,  -- YYYY-MM-DD
  entry_time    TEXT,              -- HH:MM (local)
  dose          REAL,
  dose_unit     TEXT,
  meal_type     TEXT    CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
  notes         TEXT,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_nutrition_supplement_entries_pot_date ON nutrition_supplement_entries(pot_id, entry_date DESC);
CREATE INDEX idx_nutrition_supplement_entries_supplement ON nutrition_supplement_entries(supplement_id, entry_date DESC);

CREATE TABLE nutrition_pattern_analyses (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  analysis_type   TEXT    NOT NULL CHECK(analysis_type IN ('food_symptom','ingredient_sensitivity','stack_review')),
  model_id        TEXT    NOT NULL,
  prompt_version  TEXT    NOT NULL,
  date_range_from TEXT    NOT NULL,
  date_range_to   TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL,
  triggered_by    TEXT    NOT NULL DEFAULT 'manual',
  created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_nutrition_pattern_analyses_pot ON nutrition_pattern_analyses(pot_id, analysis_type, created_at DESC);
