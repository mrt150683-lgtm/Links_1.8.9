-- Migration 0004: Analyses and keywords tables

CREATE TABLE IF NOT EXISTS analyses (
  analysis_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(repo_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  model TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_snapshot_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  llm_scores_json TEXT NOT NULL,
  final_score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_run_id ON analyses(run_id);
CREATE INDEX IF NOT EXISTS idx_analyses_repo_id ON analyses(repo_id);

CREATE TABLE IF NOT EXISTS keywords (
  keyword_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  repo_id TEXT REFERENCES repos(repo_id),
  keyword TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_keywords_run_id ON keywords(run_id);
CREATE INDEX IF NOT EXISTS idx_keywords_repo_id ON keywords(repo_id);
