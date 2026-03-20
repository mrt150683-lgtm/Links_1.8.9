-- Migration 0005: Briefs table

CREATE TABLE IF NOT EXISTS briefs (
  brief_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  score REAL NOT NULL,
  repo_ids_json TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  brief_md TEXT NOT NULL,
  outreach_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_briefs_run_id ON briefs(run_id);
CREATE INDEX IF NOT EXISTS idx_briefs_score ON briefs(score DESC);
