-- 031: Flow correlation IDs
-- Adds flow_id to processing_jobs and job_id to audit_events for end-to-end tracing.

ALTER TABLE processing_jobs ADD COLUMN flow_id TEXT;
CREATE INDEX idx_jobs_flow_id ON processing_jobs(flow_id) WHERE flow_id IS NOT NULL;

ALTER TABLE audit_events ADD COLUMN job_id TEXT;
CREATE INDEX idx_audit_events_job_id ON audit_events(job_id) WHERE job_id IS NOT NULL;
