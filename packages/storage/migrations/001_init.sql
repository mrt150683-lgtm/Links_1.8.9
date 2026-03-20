-- Migration 001: Initial schema for pots, entries, and audit_events
-- Phase 2: SQLite local-first storage

-- Enable foreign key support (must be set per connection)
PRAGMA foreign_keys = ON;

-- Pots: research projects/vaults
CREATE TABLE pots (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  security_level TEXT NOT NULL DEFAULT 'standard',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_pots_updated_at ON pots(updated_at);

-- Entries: captured items (text only in Phase 2)
CREATE TABLE entries (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text')),
  content_text TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  capture_method TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  notes TEXT,
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_entries_pot_id_captured_at ON entries(pot_id, captured_at);
CREATE INDEX idx_entries_pot_id_created_at ON entries(pot_id, created_at);
CREATE INDEX idx_entries_content_sha256 ON entries(content_sha256);

-- Audit events: provenance trail
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK(actor IN ('user', 'system', 'extension')),
  action TEXT NOT NULL,
  pot_id TEXT,
  entry_id TEXT,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE SET NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_audit_events_timestamp ON audit_events(timestamp);
CREATE INDEX idx_audit_events_pot_id ON audit_events(pot_id);
CREATE INDEX idx_audit_events_action ON audit_events(action);
