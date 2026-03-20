-- Migration 004: Phase 5 - Processing Engine (Jobs + Worker)
-- Creates processing_jobs and job_logs tables for local-first job queue

PRAGMA foreign_keys = ON;

-- Processing jobs: queue for background processing tasks
CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  pot_id TEXT,
  entry_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'done', 'failed', 'dead', 'canceled')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after INTEGER NOT NULL,  -- epoch ms, allows scheduled/backoff jobs
  locked_by TEXT,              -- worker id that claimed this job
  locked_at INTEGER,           -- epoch ms when job was claimed
  last_error TEXT,             -- last error message (sanitized)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pot_id) REFERENCES pots(id) ON DELETE SET NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
) STRICT;

-- Composite index for efficient job claiming
-- Worker queries: status IN (queued, failed) AND run_after <= now ORDER BY priority DESC, run_after ASC
CREATE INDEX idx_jobs_claim ON processing_jobs(status, run_after, priority DESC, created_at);

-- Index for lock timeout reclaim (find stale running jobs)
CREATE INDEX idx_jobs_locked_at ON processing_jobs(status, locked_at);

-- Index for filtering by pot/entry
CREATE INDEX idx_jobs_pot_id ON processing_jobs(pot_id);
CREATE INDEX idx_jobs_entry_id ON processing_jobs(entry_id);

-- Index for job type filtering
CREATE INDEX idx_jobs_type_status ON processing_jobs(job_type, status);

-- Job logs: structured event log for job execution (optional but recommended)
-- Provides deep traceability without bloating processing_jobs.last_error
CREATE TABLE job_logs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  data_json TEXT NOT NULL,  -- structured details (sanitized)
  FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_job_logs_job_id_timestamp ON job_logs(job_id, timestamp DESC);
