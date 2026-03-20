-- Migration 011: Generated Intelligence Pipeline
-- Creates tables for the Q→A→Promote pipeline (intelligence runs, questions, answers, dedupe)

PRAGMA foreign_keys = ON;

-- ============================================================================
-- Intelligence Runs Table
-- ============================================================================
-- One record per "Generate Intelligence" button press.
-- Tracks the pot snapshot, mode, model, token estimates, and status.

CREATE TABLE intelligence_runs (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,

  -- Mode: 'full' = full entry texts in context, 'digest' = summaries/tags/entities only
  mode TEXT NOT NULL CHECK (mode IN ('full', 'digest')),

  -- Model used for question generation stage
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  -- Pot snapshot hash: sha256 of sorted entry_id:content_hash pairs
  -- Used for dedupe: same hash → skip already-known questions
  pot_snapshot_hash TEXT NOT NULL,

  -- Token estimates (for UI feedback and mode selection)
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  context_length INTEGER NOT NULL DEFAULT 0,

  -- Run status
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error_message TEXT,

  created_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;

-- Index for pot-level run history (newest first)
CREATE INDEX idx_intelligence_runs_pot ON intelligence_runs(pot_id, created_at DESC);

-- Index for status polling
CREATE INDEX idx_intelligence_runs_status ON intelligence_runs(status, created_at DESC);


-- ============================================================================
-- Intelligence Questions Table
-- ============================================================================
-- Questions generated from a run. Each question references 2+ entries.
-- Status tracks whether an answer job has been run for this question.

CREATE TABLE intelligence_questions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,

  -- Stable dedupe key: sha256(normalized_question + "|" + sorted_entry_ids + "|" + prompt_version)
  question_signature TEXT NOT NULL,

  question_text TEXT NOT NULL,

  -- JSON array of entry IDs involved (sorted, 2+ entries required)
  entry_ids_json TEXT NOT NULL,

  -- Optional classification from the model
  category TEXT CHECK (category IN ('synthesis', 'contradiction_check', 'timeline', 'claim_validation', 'entity_profile', 'other')),
  rationale TEXT,

  -- Status of the answer job for this question
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),

  created_at INTEGER NOT NULL
) STRICT;

-- Index for run-level queries (list questions for a run)
CREATE INDEX idx_intelligence_questions_run ON intelligence_questions(run_id, created_at ASC);

-- Index for pot-level queries
CREATE INDEX idx_intelligence_questions_pot ON intelligence_questions(pot_id, created_at DESC);

-- Index for status (find queued questions for worker)
CREATE INDEX idx_intelligence_questions_status ON intelligence_questions(status, created_at ASC);

-- Signature lookup (used during dedupe check)
CREATE INDEX idx_intelligence_questions_sig ON intelligence_questions(question_signature);


-- ============================================================================
-- Intelligence Answers Table
-- ============================================================================
-- AI-generated answer to a specific question, with evidence excerpts and provenance.

CREATE TABLE intelligence_answers (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL REFERENCES intelligence_questions(id) ON DELETE CASCADE,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,

  -- The answer text
  answer_text TEXT NOT NULL,

  -- AI confidence 0..1 (low = insufficient evidence, high = well-supported)
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- JSON array: [{ entry_id, excerpt, start_offset?, end_offset? }]
  evidence_json TEXT NOT NULL,

  -- Excerpt validation result: 'pass' | 'fail'
  excerpt_validation TEXT NOT NULL CHECK (excerpt_validation IN ('pass', 'fail')),
  -- Details of any validation failures
  excerpt_validation_details TEXT,

  -- Optional: model noted limits or caveats (e.g., "Insufficient evidence in some areas")
  limits_text TEXT,

  -- Provenance
  model_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  temperature REAL NOT NULL,

  -- JSON: { prompt_tokens, completion_tokens, total_tokens } (optional, if API returns usage)
  token_usage_json TEXT,

  created_at INTEGER NOT NULL
) STRICT;

-- One answer per question (a question can only be answered once; re-run = new run)
CREATE UNIQUE INDEX idx_intelligence_answers_question ON intelligence_answers(question_id);

-- Pot-level answer lookup
CREATE INDEX idx_intelligence_answers_pot ON intelligence_answers(pot_id, created_at DESC);

-- Confidence-ranked queries
CREATE INDEX idx_intelligence_answers_confidence ON intelligence_answers(pot_id, confidence DESC);


-- ============================================================================
-- Intelligence Known Questions Table (Dedupe Registry)
-- ============================================================================
-- Tracks which question signatures have been seen for a given pot+snapshot.
-- Prevents re-generating the same question across multiple runs on the same snapshot.

CREATE TABLE intelligence_known_questions (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL REFERENCES pots(id) ON DELETE CASCADE,

  -- null = global pot scope (ignore snapshot changes); non-null = snapshot-scoped dedupe
  pot_snapshot_hash TEXT,

  -- Same computation as intelligence_questions.question_signature
  question_signature TEXT NOT NULL,

  -- Reference to the most recent question record for this signature
  last_question_id TEXT REFERENCES intelligence_questions(id) ON DELETE SET NULL,

  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  times_seen INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Core uniqueness: one known-question record per (pot, snapshot, signature)
-- snapshot_hash can be null, so we use a partial approach via application-level upsert
CREATE UNIQUE INDEX idx_intelligence_known_questions_unique ON intelligence_known_questions(
  pot_id,
  COALESCE(pot_snapshot_hash, ''),
  question_signature
);

-- Signature lookup within a pot
CREATE INDEX idx_intelligence_known_questions_sig ON intelligence_known_questions(pot_id, question_signature);
