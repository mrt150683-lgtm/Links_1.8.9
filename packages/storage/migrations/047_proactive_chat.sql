-- 047_proactive_chat.sql
-- Add proactive_conversations_enabled flag to pot automation settings.
-- SQLite STRICT tables allow ADD COLUMN with a DEFAULT value.

ALTER TABLE pot_automation_settings
  ADD COLUMN proactive_conversations_enabled INTEGER NOT NULL DEFAULT 0;
