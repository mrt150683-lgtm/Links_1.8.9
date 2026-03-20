-- 049_proactive_chat_model.sql
-- Adds per-pot model override for proactive conversations.
-- Nullable TEXT — no DEFAULT needed, safe ADD COLUMN.

ALTER TABLE pot_automation_settings
  ADD COLUMN proactive_conversation_model TEXT;
