-- 036: Nutrition module tables
-- No table rebuild required; all nutrition data lives in new dedicated tables.

CREATE TABLE nutrition_meals (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  meal_date       TEXT    NOT NULL,
  meal_type       TEXT    NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
  asset_id        TEXT    REFERENCES assets(id) ON DELETE SET NULL,
  user_note       TEXT,
  user_correction TEXT,
  analysis_json   TEXT,
  error_message   TEXT,
  accepted        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_nutrition_meals_pot_date ON nutrition_meals(pot_id, meal_date DESC);
CREATE INDEX idx_nutrition_meals_date ON nutrition_meals(meal_date);

CREATE TABLE nutrition_daily_reviews (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  review_date     TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  prompt_version  TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL,
  meal_ids_json   TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(pot_id, review_date)
) STRICT;

CREATE INDEX idx_nutrition_daily_reviews_pot_date ON nutrition_daily_reviews(pot_id, review_date DESC);

CREATE TABLE nutrition_weekly_check_ins (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  week_key        TEXT    NOT NULL,
  weight          REAL,
  weight_unit     TEXT    CHECK(weight_unit IN ('kg','lbs')),
  body_fat_pct    REAL,
  rating          INTEGER CHECK(rating BETWEEN 1 AND 5),
  notes           TEXT,
  submitted_at    INTEGER NOT NULL,
  UNIQUE(pot_id, week_key)
) STRICT;

CREATE TABLE nutrition_weekly_reviews (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  week_key        TEXT    NOT NULL,
  check_in_id     TEXT    REFERENCES nutrition_weekly_check_ins(id) ON DELETE SET NULL,
  model_id        TEXT    NOT NULL,
  prompt_version  TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(pot_id, week_key)
) STRICT;

CREATE INDEX idx_nutrition_weekly_reviews_pot ON nutrition_weekly_reviews(pot_id, week_key DESC);

CREATE TABLE nutrition_recipes (
  id              TEXT    PRIMARY KEY NOT NULL,
  pot_id          TEXT    NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK(category IN ('starter','main','dessert','snack')),
  cuisine_tags    TEXT    NOT NULL DEFAULT '[]',
  key_ingredients TEXT    NOT NULL DEFAULT '[]',
  flavor_profile  TEXT,
  meal_type_tags  TEXT    NOT NULL DEFAULT '[]',
  full_recipe_json TEXT   NOT NULL,
  feedback        TEXT    CHECK(feedback IN ('liked','disliked')),
  generation_mode TEXT    NOT NULL CHECK(generation_mode IN ('random','ingredient_led','craving')),
  source_prompt   TEXT,
  model_id        TEXT    NOT NULL,
  prompt_version  TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_nutrition_recipes_pot_feedback ON nutrition_recipes(pot_id, feedback);
CREATE INDEX idx_nutrition_recipes_pot_category ON nutrition_recipes(pot_id, category);
