-- Migration 013: Add custom_prompt column to intelligence_runs
--
-- Stores an optional user-supplied research focus / perspective that is injected
-- into the question generation system prompt (e.g. "focus on SW security",
-- "approach from a medical professional's perspective").
-- SQLite supports ADD COLUMN for nullable columns without recreating the table.

ALTER TABLE intelligence_runs ADD COLUMN custom_prompt TEXT;
