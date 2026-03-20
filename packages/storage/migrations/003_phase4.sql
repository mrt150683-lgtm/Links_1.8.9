-- Migration 003: Phase 4 - Asset Store
-- Adds encrypted binary asset storage with deduplication
-- Rebuilds entries table to expand CHECK constraint for image/doc types

-- 1. Create assets table (global pool, deduplicated by sha256)
CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  storage_path TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_assets_sha256 ON assets(sha256);
CREATE INDEX idx_assets_created_at ON assets(created_at DESC);

-- 2. Rebuild entries table to expand type CHECK and add asset_id
--    SQLite cannot ALTER CHECK constraints, so we must recreate the table.
--    Steps: disable FK checks, create new table, copy data, drop old, rename, recreate indices.

PRAGMA foreign_keys = OFF;

CREATE TABLE entries_new (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'image', 'doc')),
  content_text TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT NOT NULL DEFAULT '',
  capture_method TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  notes TEXT,
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Phase 3 columns
  client_capture_id TEXT,
  source_app TEXT,
  source_context_json TEXT,
  -- Phase 4 columns
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE CASCADE
) STRICT;

-- Copy existing data (all existing entries are type='text', asset_id=NULL)
INSERT INTO entries_new (
  id, pot_id, type, content_text, content_sha256, capture_method,
  source_url, source_title, notes, captured_at, created_at, updated_at,
  client_capture_id, source_app, source_context_json, asset_id
)
SELECT
  id, pot_id, type, content_text, content_sha256, capture_method,
  source_url, source_title, notes, captured_at, created_at, updated_at,
  client_capture_id, source_app, source_context_json, NULL
FROM entries;

DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;

-- Recreate all indices (from 001 + 002 + new)
CREATE INDEX idx_entries_pot_id_captured_at ON entries(pot_id, captured_at);
CREATE INDEX idx_entries_pot_id_created_at ON entries(pot_id, created_at);
CREATE INDEX idx_entries_content_sha256 ON entries(content_sha256);
CREATE UNIQUE INDEX idx_entries_pot_client_capture_id
  ON entries(pot_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;
CREATE INDEX idx_entries_pot_hash_created
  ON entries(pot_id, content_sha256, created_at DESC);
CREATE INDEX idx_entries_asset_id ON entries(asset_id);

PRAGMA foreign_keys = ON;
-- Verify FK integrity after rebuild
PRAGMA foreign_key_check;
