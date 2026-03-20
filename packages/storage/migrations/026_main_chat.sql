-- Global (non-pot-scoped) chat threads for MainChat
CREATE TABLE main_chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  model_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE main_chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations_json TEXT,
  token_usage_json TEXT,
  model_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES main_chat_threads(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_main_chat_threads_updated ON main_chat_threads(updated_at DESC);
CREATE INDEX idx_main_chat_messages_thread ON main_chat_messages(thread_id, created_at);
