-- Migration 014: Add max_questions column to intelligence_runs
--
-- Stores the user-requested question count for a run so the worker
-- can use the correct limit (instead of a hardcoded value).
-- Default 2 matches the new UI default for low-cost testing.

ALTER TABLE intelligence_runs ADD COLUMN max_questions INTEGER NOT NULL DEFAULT 2;
