-- Migration 005: Phase 12 - Full-Text Search with FTS5
-- Implements SQLite FTS5 virtual table for efficient searching across entries

PRAGMA foreign_keys = ON;

-- Create FTS5 virtual table
-- Indexes: entry_id, pot_id, content (title, text content, link url/title, summary)
CREATE VIRTUAL TABLE entries_fts USING fts5(
  entry_id UNINDEXED,
  pot_id UNINDEXED,
  content,
  title,
  tokenize = 'porter'
);

-- Note: FTS5 virtual tables use their own internal indexing.
-- Regular CREATE INDEX statements are not allowed on FTS5 tables.
-- The content and title columns are automatically indexed by FTS5.

-- Trigger: insert
-- When a new entry is created, add it to FTS index
CREATE TRIGGER entries_ai AFTER INSERT ON entries
BEGIN
  INSERT INTO entries_fts(entry_id, pot_id, content, title)
  VALUES (
    NEW.id,
    NEW.pot_id,
    COALESCE(NEW.content_text, '') || ' ' || COALESCE(NEW.link_url, '') || ' ' || COALESCE(NEW.link_title, ''),
    COALESCE(NEW.link_title, '')
  );
END;

-- Trigger: update
-- When an entry is updated, update its FTS index
CREATE TRIGGER entries_au AFTER UPDATE ON entries
BEGIN
  DELETE FROM entries_fts WHERE entry_id = OLD.id;
  INSERT INTO entries_fts(entry_id, pot_id, content, title)
  VALUES (
    NEW.id,
    NEW.pot_id,
    COALESCE(NEW.content_text, '') || ' ' || COALESCE(NEW.link_url, '') || ' ' || COALESCE(NEW.link_title, ''),
    COALESCE(NEW.link_title, '')
  );
END;

-- Trigger: delete
-- When an entry is deleted, remove it from FTS index
CREATE TRIGGER entries_ad AFTER DELETE ON entries
BEGIN
  DELETE FROM entries_fts WHERE entry_id = OLD.id;
END;

-- Backfill: populate FTS with existing entries
INSERT INTO entries_fts(entry_id, pot_id, content, title)
SELECT
  id,
  pot_id,
  COALESCE(content_text, '') || ' ' || COALESCE(link_url, '') || ' ' || COALESCE(link_title, ''),
  COALESCE(link_title, '')
FROM entries;
