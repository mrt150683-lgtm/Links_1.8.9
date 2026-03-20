-- Migration 015: Journal Module
--
-- 1. Adds payload_json column to processing_jobs for structured job input.
-- 2. Creates journal_entries table for daily/weekly/monthly/quarterly/yearly notes.

-- 1. Extend processing_jobs with payload support
ALTER TABLE processing_jobs ADD COLUMN payload_json TEXT;

-- 2. Journal entries table (STRICT mode requires SQLite >= 3.37.0)
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('pot', 'global')),
  scope_id TEXT,
  period_start_ymd TEXT NOT NULL,
  period_end_ymd TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  temperature REAL NOT NULL,
  max_tokens INTEGER,
  input_fingerprint TEXT NOT NULL,
  content_json TEXT NOT NULL,
  citations_json TEXT NOT NULL
) STRICT;

-- Idempotency unique index using COALESCE to handle NULL scope_id correctly
-- (SQLite NULL != NULL in table-level UNIQUE, so expression index is required)
CREATE UNIQUE INDEX idx_journal_entries_unique ON journal_entries(
  kind,
  scope_type,
  COALESCE(scope_id, ''),
  period_start_ymd,
  prompt_id,
  prompt_version
);

-- Query index: retrieve notes for a scope + kind + period
CREATE INDEX idx_journal_entries_lookup ON journal_entries(
  kind,
  scope_type,
  scope_id,
  period_start_ymd
);

-- Query index: list recent notes for a scope
CREATE INDEX idx_journal_entries_recent ON journal_entries(
  scope_type,
  scope_id,
  created_at DESC
);
