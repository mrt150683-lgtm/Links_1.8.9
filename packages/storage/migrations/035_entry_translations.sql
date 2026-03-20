CREATE TABLE entry_translations (
  id                    TEXT    PRIMARY KEY NOT NULL,
  entry_id              TEXT    NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_language       TEXT    NOT NULL,
  target_language_code  TEXT    NOT NULL,
  translated_text       TEXT    NOT NULL,
  model_id              TEXT    NOT NULL,
  chunk_count           INTEGER NOT NULL DEFAULT 1,
  source_hash           TEXT    NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  UNIQUE (entry_id, target_language)
) STRICT;

CREATE INDEX idx_entry_translations_entry_id ON entry_translations(entry_id);
