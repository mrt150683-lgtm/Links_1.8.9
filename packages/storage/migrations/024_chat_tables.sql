-- Chat threads (one per pot conversation)
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT NOT NULL,
  title TEXT,
  model_id TEXT,
  personality_prompt_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_chat_threads_pot ON chat_threads(pot_id, updated_at DESC);

-- Chat messages (append-only)
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations_json TEXT,
  token_usage_json TEXT,
  model_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, created_at);
