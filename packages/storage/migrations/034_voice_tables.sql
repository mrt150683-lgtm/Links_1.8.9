-- 034: Voice Addon v1 tables

CREATE TABLE voice_settings (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  selected_input_device       TEXT,
  selected_output_device      TEXT,
  selected_stt_engine         TEXT    NOT NULL DEFAULT 'openrouter',
  selected_voice_id           TEXT,
  silence_timeout_ms          INTEGER NOT NULL DEFAULT 1100,
  vad_threshold               REAL    NOT NULL DEFAULT 0.5,
  push_to_talk_enabled        INTEGER NOT NULL DEFAULT 0,
  manual_send_enabled         INTEGER NOT NULL DEFAULT 0,
  interruption_enabled        INTEGER NOT NULL DEFAULT 1,
  partial_transcripts_enabled INTEGER NOT NULL DEFAULT 1,
  stream_tts_enabled          INTEGER NOT NULL DEFAULT 0,
  local_only_mode             INTEGER NOT NULL DEFAULT 0,
  updated_at                  INTEGER NOT NULL
) STRICT;

INSERT INTO voice_settings (id, updated_at) VALUES (1, 0);

CREATE TABLE voice_voices (
  id            TEXT    PRIMARY KEY NOT NULL,
  display_name  TEXT    NOT NULL,
  lang_code     TEXT    NOT NULL,
  speaker_name  TEXT    NOT NULL,
  quality       TEXT    NOT NULL CHECK (quality IN ('low','medium','high','x_low')),
  engine_type   TEXT    NOT NULL DEFAULT 'piper' CHECK (engine_type = 'piper'),
  source_path   TEXT    NOT NULL,
  is_imported   INTEGER NOT NULL DEFAULT 0,
  file_hash     TEXT,
  sample_rate   INTEGER,
  num_speakers  INTEGER NOT NULL DEFAULT 1,
  piper_version TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_voice_voices_source_path ON voice_voices(source_path);
CREATE INDEX idx_voice_voices_lang ON voice_voices(lang_code);

CREATE TABLE voice_sessions (
  id                    TEXT    PRIMARY KEY NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','stopped','errored')),
  voice_id              TEXT,
  stt_engine            TEXT,
  input_device          TEXT,
  output_device         TEXT,
  pot_id                TEXT    REFERENCES pots(id) ON DELETE SET NULL,
  turn_count            INTEGER NOT NULL DEFAULT 0,
  interruption_count    INTEGER NOT NULL DEFAULT 0,
  avg_stt_latency_ms    REAL,
  avg_tts_latency_ms    REAL,
  error_message         TEXT,
  started_at            INTEGER NOT NULL,
  stopped_at            INTEGER,
  updated_at            INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_voice_sessions_status ON voice_sessions(status, started_at DESC);

CREATE TABLE voice_session_events (
  id           TEXT    PRIMARY KEY NOT NULL,
  session_id   TEXT    NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  event_type   TEXT    NOT NULL,
  payload_json TEXT,
  latency_ms   INTEGER,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_voice_session_events_session ON voice_session_events(session_id, created_at);
