-- Migration 002: Phase 3 - Ingestion API extensions
PRAGMA foreign_keys = ON;

-- 1. Add last_used_at to pots for popup sorting
ALTER TABLE pots ADD COLUMN last_used_at INTEGER;
CREATE INDEX idx_pots_last_used_at ON pots(last_used_at DESC);

-- 2. User preferences (key-value store)
CREATE TABLE user_prefs (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
) STRICT;

-- 3. Add idempotency and metadata to entries
ALTER TABLE entries ADD COLUMN client_capture_id TEXT;
ALTER TABLE entries ADD COLUMN source_app TEXT;
ALTER TABLE entries ADD COLUMN source_context_json TEXT;

-- Unique constraint for client_capture_id per pot
CREATE UNIQUE INDEX idx_entries_pot_client_capture_id
  ON entries(pot_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;

-- Index for hash-based dedupe (60-second window fallback)
CREATE INDEX idx_entries_pot_hash_created
  ON entries(pot_id, content_sha256, created_at DESC);
