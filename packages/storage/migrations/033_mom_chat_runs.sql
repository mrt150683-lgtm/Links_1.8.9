-- 033: MoM (Mixture of Models) chat run tables
-- Tracks the full lifecycle of multi-model chat orchestration runs.

CREATE TABLE chat_runs (
  id                  TEXT    PRIMARY KEY NOT NULL,
  thread_id           TEXT    NOT NULL,
  pot_id              TEXT,
  user_message_id     TEXT,
  chat_surface        TEXT    NOT NULL CHECK(chat_surface IN ('pot','main')),
  execution_mode      TEXT    NOT NULL CHECK(execution_mode IN ('single','mom_lite','mom_standard','mom_heavy')),
  status              TEXT    NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','planning','running','merging','done','failed','cancelled')),
  planner_model_id    TEXT,
  merge_model_id      TEXT,
  planner_output_json TEXT,
  final_output_json   TEXT,
  context_fingerprint TEXT,
  error_message       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  started_at          INTEGER,
  finished_at         INTEGER,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_chat_runs_thread_id ON chat_runs(thread_id);
CREATE INDEX idx_chat_runs_status ON chat_runs(status, created_at DESC);
CREATE INDEX idx_chat_runs_pot_id ON chat_runs(pot_id);

CREATE TABLE chat_run_agents (
  id               TEXT    PRIMARY KEY NOT NULL,
  chat_run_id      TEXT    NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  agent_index      INTEGER NOT NULL,
  agent_role       TEXT    NOT NULL,
  model_id         TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','running','done','failed')),
  input_hash       TEXT,
  output_json      TEXT,
  latency_ms       INTEGER,
  token_usage_json TEXT,
  error_message    TEXT,
  started_at       INTEGER,
  finished_at      INTEGER
) STRICT;

CREATE INDEX idx_chat_run_agents_run_id ON chat_run_agents(chat_run_id);

CREATE TABLE chat_run_reviews (
  id                  TEXT    PRIMARY KEY NOT NULL,
  chat_run_id         TEXT    NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  reviewer_agent_id   TEXT    REFERENCES chat_run_agents(id) ON DELETE SET NULL,
  target_agent_id     TEXT    REFERENCES chat_run_agents(id) ON DELETE SET NULL,
  model_id            TEXT    NOT NULL,
  review_output_json  TEXT,
  latency_ms          INTEGER,
  token_usage_json    TEXT,
  created_at          INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_chat_run_reviews_run_id ON chat_run_reviews(chat_run_id);

CREATE TABLE chat_run_events (
  id           TEXT    PRIMARY KEY NOT NULL,
  chat_run_id  TEXT    NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
  event_type   TEXT    NOT NULL,
  payload_json TEXT,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_chat_run_events_run_id ON chat_run_events(chat_run_id, created_at);
