-- Migration 020: Add extracted_text artifact type
-- Extends derived_artifacts.artifact_type CHECK constraint to include 'extracted_text'
-- Pattern: rebuild table (SQLite cannot ALTER CHECK constraints)

PRAGMA foreign_keys = OFF;

-- Create new derived_artifacts table with extracted_text type added
CREATE TABLE derived_artifacts_new (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,

  -- Artifact metadata
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('tags', 'entities', 'summary', 'extracted_text')),
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- Provenance (full reproducibility)
  model_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  temperature REAL NOT NULL,
  max_tokens INTEGER,
  created_at INTEGER NOT NULL,

  -- Provenance extension (migration 018)
  role_hash TEXT,

  -- Payload (validated JSON)
  payload_json TEXT NOT NULL,
  evidence_json TEXT,

  -- Uniqueness constraint: allows deterministic reprocessing
  -- Same entry + type + prompt version = same artifact (upsert)
  UNIQUE(entry_id, artifact_type, prompt_id, prompt_version)
) STRICT;

-- Copy all existing data
INSERT INTO derived_artifacts_new SELECT * FROM derived_artifacts;

-- Drop old table
DROP TABLE derived_artifacts;

-- Rename new table
ALTER TABLE derived_artifacts_new RENAME TO derived_artifacts;

-- Recreate all indices
CREATE INDEX idx_artifacts_entry_type_created
  ON derived_artifacts(entry_id, artifact_type, created_at DESC);

CREATE INDEX idx_artifacts_pot_type_created
  ON derived_artifacts(pot_id, artifact_type, created_at DESC);

CREATE INDEX idx_artifacts_type_created
  ON derived_artifacts(artifact_type, created_at DESC);

PRAGMA foreign_keys = ON;

-- Verify FK integrity after rebuild
PRAGMA foreign_key_check;
