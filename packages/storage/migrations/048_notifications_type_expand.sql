-- 048_notifications_type_expand.sql
-- Expand main_chat_notifications.type CHECK constraint to include 'digest' and 'conversation'.
-- SQLite cannot ALTER CHECK constraints, so we rebuild the table (standard pattern).

PRAGMA foreign_keys = OFF;

CREATE TABLE main_chat_notifications_new (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('greeting', 'triage', 'insight', 'goal_aligned', 'reminder', 'system', 'digest', 'conversation')),
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread', 'opened', 'dismissed', 'snoozed', 'expired')),
  snoozed_until INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  flow_id TEXT
) STRICT;

INSERT INTO main_chat_notifications_new
  SELECT id, type, title, preview, payload_json, state, snoozed_until, read_at, created_at, flow_id
  FROM main_chat_notifications;

DROP TABLE main_chat_notifications;

ALTER TABLE main_chat_notifications_new RENAME TO main_chat_notifications;

CREATE INDEX idx_main_chat_notif_state ON main_chat_notifications(state, created_at DESC);
CREATE INDEX idx_main_chat_notif_flow_id ON main_chat_notifications(flow_id) WHERE flow_id IS NOT NULL;

PRAGMA foreign_keys = ON;
