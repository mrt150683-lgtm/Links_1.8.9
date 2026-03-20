-- Migration 004: Phase 11 - Extension Bridge
PRAGMA foreign_keys = ON;

-- 1. Extend entries.type to include 'link'
-- SQLite limitation: Cannot modify CHECK constraint directly
-- Add link-specific columns; enforce type constraints at application layer

ALTER TABLE entries ADD COLUMN link_url TEXT;
ALTER TABLE entries ADD COLUMN link_title TEXT;

CREATE INDEX idx_entries_link_url ON entries(link_url) WHERE link_url IS NOT NULL;

-- Application-layer constraints (enforced in code):
-- - If type='link': link_url NOT NULL, content_text optional (excerpt)
-- - If type IN ('text','image','doc'): link_url NULL, link_title NULL
-- - Expanded type check: type IN ('text', 'image', 'doc', 'link')

-- No schema changes for extension token - storing in user_prefs as 'ext.auth.token'
