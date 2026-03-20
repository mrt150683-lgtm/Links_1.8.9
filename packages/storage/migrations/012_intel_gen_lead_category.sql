-- Migration 012: Add 'lead' category to intelligence_questions
--
-- SQLite does not support ALTER TABLE to change CHECK constraints, so we
-- recreate the table with the updated constraint (standard SQLite technique).
-- Adds 'lead' to the allowed category values for single-document research leads.

PRAGMA foreign_keys = OFF;

BEGIN;

-- Create replacement table with updated CHECK constraint
CREATE TABLE intelligence_questions_new (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,

  question_signature TEXT NOT NULL,
  question_text TEXT NOT NULL,

  -- JSON array of entry IDs involved (1+ entries; cross-doc questions use 2+)
  entry_ids_json TEXT NOT NULL,

  -- Optional classification from the model (now includes 'lead' for single-doc threads)
  category TEXT CHECK (category IN ('synthesis', 'contradiction_check', 'timeline', 'claim_validation', 'entity_profile', 'lead', 'other')),
  rationale TEXT,

  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),

  created_at INTEGER NOT NULL
) STRICT;

-- Copy all existing rows
INSERT INTO intelligence_questions_new SELECT * FROM intelligence_questions;

-- Drop old table (indexes drop automatically)
DROP TABLE intelligence_questions;

-- Rename new table
ALTER TABLE intelligence_questions_new RENAME TO intelligence_questions;

-- Recreate indexes
CREATE INDEX idx_intelligence_questions_run ON intelligence_questions(run_id, created_at ASC);
CREATE INDEX idx_intelligence_questions_pot ON intelligence_questions(pot_id, created_at DESC);
CREATE INDEX idx_intelligence_questions_status ON intelligence_questions(status, created_at ASC);
CREATE INDEX idx_intelligence_questions_sig ON intelligence_questions(question_signature);

COMMIT;

PRAGMA foreign_keys = ON;
