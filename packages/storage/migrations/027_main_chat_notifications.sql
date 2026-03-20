-- MainChat global notification inbox
CREATE TABLE main_chat_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('greeting', 'triage', 'insight', 'goal_aligned', 'reminder', 'system')),
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  state TEXT NOT NULL DEFAULT 'unread' CHECK(state IN ('unread', 'opened', 'dismissed', 'snoozed', 'expired')),
  snoozed_until INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_main_chat_notif_state ON main_chat_notifications(state, created_at DESC);
