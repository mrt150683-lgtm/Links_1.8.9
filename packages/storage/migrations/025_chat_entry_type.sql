PRAGMA foreign_keys = OFF;

CREATE TABLE entries_new (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'image', 'doc', 'link', 'audio', 'chat')),
  content_text TEXT,
  content_sha256 TEXT,
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
  -- Phase 11 columns
  link_url TEXT,
  link_title TEXT,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE CASCADE
) STRICT;

INSERT INTO entries_new SELECT * FROM entries;
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;

-- Recreate all indices
CREATE INDEX idx_entries_pot_id_captured_at ON entries(pot_id, captured_at);
CREATE INDEX idx_entries_pot_id_created_at ON entries(pot_id, created_at);
CREATE INDEX idx_entries_content_sha256 ON entries(content_sha256);
CREATE UNIQUE INDEX idx_entries_pot_client_capture_id
  ON entries(pot_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;
CREATE INDEX idx_entries_pot_hash_created
  ON entries(pot_id, content_sha256, created_at DESC);
CREATE INDEX idx_entries_asset_id ON entries(asset_id);
CREATE INDEX idx_entries_link_url ON entries(link_url) WHERE link_url IS NOT NULL;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
