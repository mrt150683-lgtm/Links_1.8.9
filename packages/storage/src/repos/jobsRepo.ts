/**
 * Jobs repository - Job queue operations with atomic claiming
 * Phase 5: Processing Engine
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import { calculateBackoff } from '../backoff.js';
import { logAuditEvent } from './auditRepo.js';
import type { ProcessingJob } from '../types.js';

export interface EnqueueJobInput {
  job_type: string;
  pot_id?: string;
  entry_id?: string;
  priority?: number;
  run_after?: number; // epoch ms, defaults to now
  max_attempts?: number;
  payload?: unknown; // Journal module: structured job payload (serialized to payload_json)
  flow_id?: string; // flow correlation (031_flow_correlation)
}

export interface ClaimJobResult {
  job: ProcessingJob;
  isReclaim: boolean; // true if reclaimed from stale lock
}

export interface ListJobsFilter {
  status?: 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'canceled';
  job_type?: string;
  pot_id?: string;
  entry_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Enqueue a new job
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<ProcessingJob> {
  const db = getDatabase();
  const now = Date.now();

  const jobRow = {
    id: randomUUID(),
    pot_id: input.pot_id ?? null,
    entry_id: input.entry_id ?? null,
    job_type: input.job_type,
    status: 'queued' as const,
    priority: input.priority ?? 0,
    attempts: 0,
    max_attempts: input.max_attempts ?? 3,
    run_after: input.run_after ?? now,
    locked_by: null,
    locked_at: null,
    last_error: null,
    payload_json: input.payload != null ? JSON.stringify(input.payload) : null,
    flow_id: input.flow_id ?? null,
    created_at: now,
    updated_at: now,
  };

  await db.insertInto('processing_jobs').values(jobRow).execute();

  // Audit event
  await logAuditEvent({
    actor: 'system',
    action: 'job_enqueued',
    pot_id: jobRow.pot_id ?? undefined,
    entry_id: jobRow.entry_id ?? undefined,
    metadata: {
      job_id: jobRow.id,
      job_type: jobRow.job_type,
      priority: jobRow.priority,
      run_after: jobRow.run_after,
    },
  });

  return { ...jobRow, payload: input.payload ?? null, flow_id: jobRow.flow_id } as ProcessingJob;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<ProcessingJob | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('processing_jobs')
    .selectAll()
    .where('id', '=', jobId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    ...row,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    flow_id: row.flow_id ?? null,
  } as ProcessingJob;
}

/**
 * List jobs with filters
 */
export async function listJobs(filter: ListJobsFilter = {}): Promise<ProcessingJob[]> {
  const db = getDatabase();

  let query = db.selectFrom('processing_jobs').selectAll();

  if (filter.status) {
    query = query.where('status', '=', filter.status);
  }
  if (filter.job_type) {
    query = query.where('job_type', '=', filter.job_type);
  }
  if (filter.pot_id) {
    query = query.where('pot_id', '=', filter.pot_id);
  }
  if (filter.entry_id) {
    query = query.where('entry_id', '=', filter.entry_id);
  }

  query = query.orderBy('created_at', 'desc');

  if (filter.limit) {
    query = query.limit(filter.limit);
  }
  if (filter.offset) {
    query = query.offset(filter.offset);
  }

  const rows = await query.execute();
  return rows.map((row) => ({
    ...row,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    flow_id: row.flow_id ?? null,
  })) as ProcessingJob[];
}

/**
 * Claim next eligible job (atomic, race-safe)
 *
 * Eligible jobs:
 * 1. Status queued or failed, run_after <= now
 * 2. Status running with locked_at older than lockTimeoutMs (reclaim stale locks)
 *
 * Ordering: priority DESC, run_after ASC, created_at ASC
 *
 * @param workerId - Unique worker identifier
 * @param now - Current timestamp (epoch ms)
 * @param lockTimeoutMs - Reclaim jobs locked longer than this (default: 10 minutes)
 * @returns Claimed job or null if none available
 */
export async function claimNextJob(
  workerId: string,
  now: number,
  lockTimeoutMs: number = 10 * 60 * 1000,
): Promise<ClaimJobResult | null> {
  const db = getDatabase();
  const lockTimeoutThreshold = now - lockTimeoutMs;

  // Strategy: Find eligible job, then attempt atomic update
  // SQLite doesn't support UPDATE...RETURNING in all contexts, so we:
  // 1. Find candidate job
  // 2. Attempt atomic update with WHERE conditions
  // 3. Verify update succeeded by reading back

  // Find candidate: queued/failed jobs ready to run
  let candidate = await db
    .selectFrom('processing_jobs')
    .selectAll()
    .where((eb) =>
      eb.or([
        // Regular jobs ready to run
        eb.and([
          eb('status', 'in', ['queued', 'failed']),
          eb('run_after', '<=', now),
        ]),
        // Stale locks (reclaim)
        eb.and([
          eb('status', '=', 'running'),
          eb('locked_at', 'is not', null),
          eb('locked_at', '<', lockTimeoutThreshold),
        ]),
      ]),
    )
    .orderBy('priority', 'desc')
    .orderBy('run_after', 'asc')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!candidate) {
    return null;
  }

  const isReclaim = candidate.status === 'running';

  // Atomic claim: update only if job unchanged
  const result = await db
    .updateTable('processing_jobs')
    .set({
      status: 'running',
      locked_by: workerId,
      locked_at: now,
      attempts: candidate.attempts + 1,
      updated_at: now,
    })
    .where('id', '=', candidate.id)
    .where('status', '=', candidate.status) // Ensure status unchanged
    .where('updated_at', '=', candidate.updated_at) // Optimistic lock
    .executeTakeFirst();

  // Verify claim succeeded
  if (result.numUpdatedRows === 0n) {
    // Another worker claimed this job, try again recursively
    return claimNextJob(workerId, now, lockTimeoutMs);
  }

  // Fetch updated job
  const claimedJob = await getJob(candidate.id);
  if (!claimedJob) {
    throw new Error(`Job disappeared after claim: ${candidate.id}`);
  }

  // Audit event
  await logAuditEvent({
    actor: 'system',
    action: isReclaim ? 'job_reclaimed' : 'job_claimed',
    pot_id: claimedJob.pot_id ?? undefined,
    entry_id: claimedJob.entry_id ?? undefined,
    metadata: {
      job_id: claimedJob.id,
      job_type: claimedJob.job_type,
      worker_id: workerId,
      attempt: claimedJob.attempts,
      is_reclaim: isReclaim,
    },
  });

  return { job: claimedJob, isReclaim };
}

/**
 * Mark job as successfully completed
 */
export async function markJobDone(jobId: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  await db
    .updateTable('processing_jobs')
    .set({
      status: 'done',
      updated_at: now,
      last_error: null, // Clear error on success
    })
    .where('id', '=', jobId)
    .execute();

  await logAuditEvent({
    actor: 'system',
    action: 'job_succeeded',
    pot_id: job.pot_id ?? undefined,
    entry_id: job.entry_id ?? undefined,
    metadata: {
      job_id: jobId,
      job_type: job.job_type,
      attempts: job.attempts,
      duration_ms: now - (job.locked_at ?? job.created_at),
    },
  });
}

/**
 * Mark job as failed (retry with backoff)
 */
export async function markJobFailed(jobId: string, error: Error): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const willRetry = job.attempts < job.max_attempts;
  const nextStatus = willRetry ? 'failed' : 'dead';
  const nextRunAfter = willRetry ? calculateBackoff(job.attempts, now) : now;

  // Sanitize error message (remove sensitive data)
  const sanitizedError = sanitizeError(error);

  await db
    .updateTable('processing_jobs')
    .set({
      status: nextStatus,
      last_error: sanitizedError,
      run_after: nextRunAfter,
      updated_at: now,
    })
    .where('id', '=', jobId)
    .execute();

  await logAuditEvent({
    actor: 'system',
    action: willRetry ? 'job_failed' : 'job_deadlettered',
    pot_id: job.pot_id ?? undefined,
    entry_id: job.entry_id ?? undefined,
    metadata: {
      job_id: jobId,
      job_type: job.job_type,
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      error_class: error.constructor.name,
      error_message: error.message.substring(0, 200), // Truncate
      next_run_after: willRetry ? nextRunAfter : undefined,
      will_retry: willRetry,
    },
  });
}

/**
 * Mark job as dead (no more retries)
 */
export async function markJobDead(jobId: string, error: Error): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const sanitizedError = sanitizeError(error);

  await db
    .updateTable('processing_jobs')
    .set({
      status: 'dead',
      last_error: sanitizedError,
      updated_at: now,
    })
    .where('id', '=', jobId)
    .execute();

  await logAuditEvent({
    actor: 'system',
    action: 'job_deadlettered',
    pot_id: job.pot_id ?? undefined,
    entry_id: job.entry_id ?? undefined,
    metadata: {
      job_id: jobId,
      job_type: job.job_type,
      attempts: job.attempts,
      error_class: error.constructor.name,
      error_message: error.message.substring(0, 200),
    },
  });
}

/**
 * Cancel a job (manual cancellation)
 */
export async function cancelJob(jobId: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  await db
    .updateTable('processing_jobs')
    .set({
      status: 'canceled',
      updated_at: now,
    })
    .where('id', '=', jobId)
    .execute();

  await logAuditEvent({
    actor: 'user',
    action: 'job_canceled',
    pot_id: job.pot_id ?? undefined,
    entry_id: job.entry_id ?? undefined,
    metadata: {
      job_id: jobId,
      job_type: job.job_type,
      previous_status: job.status,
    },
  });
}

/**
 * Sanitize error message (remove sensitive data)
 */
function sanitizeError(error: Error): string {
  let message = error.message;

  // Remove common sensitive patterns
  message = message.replace(/password[=:]\s*\S+/gi, 'password=***');
  message = message.replace(/token[=:]\s*\S+/gi, 'token=***');
  message = message.replace(/key[=:]\s*\S+/gi, 'key=***');
  message = message.replace(/secret[=:]\s*\S+/gi, 'secret=***');

  // Truncate to reasonable length
  return message.substring(0, 1000);
}

/**
 * Write job log entry
 */
export async function writeJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  await db
    .insertInto('job_logs')
    .values({
      id: randomUUID(),
      job_id: jobId,
      timestamp: now,
      level,
      message,
      data_json: JSON.stringify(data),
    })
    .execute();
}

/**
 * Get job logs
 */
export async function getJobLogs(jobId: string, limit: number = 100): Promise<
  Array<{
    id: string;
    timestamp: number;
    level: string;
    message: string;
    data: Record<string, unknown>;
  }>
> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('job_logs')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    ...row,
    data: JSON.parse(row.data_json),
  }));
}

/**
 * Phase 12: Requeue a failed or dead job for retry
 */
export async function requeueJob(jobId: string): Promise<ProcessingJob> {
  const db = getDatabase();
  const now = Date.now();

  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Only requeue failed or dead jobs
  if (job.status !== 'failed' && job.status !== 'dead') {
    throw new Error(`Job must be failed or dead to requeue (current status: ${job.status})`);
  }

  // Reset job to queued state
  await db
    .updateTable('processing_jobs')
    .set({
      status: 'queued',
      attempts: 0,
      last_error: null,
      locked_by: null,
      locked_at: null,
      updated_at: now,
    })
    .where('id', '=', jobId)
    .execute();

  await logAuditEvent({
    actor: 'user',
    action: 'job_requeued',
    pot_id: job.pot_id ?? undefined,
    entry_id: job.entry_id ?? undefined,
    metadata: {
      job_id: jobId,
      job_type: job.job_type,
      previous_status: job.status,
    },
  });

  // Return updated job
  const updated = await getJob(jobId);
  if (!updated) {
    throw new Error(`Job disappeared after requeue: ${jobId}`);
  }

  return updated;
}

/**
 * Phase 12: Requeue all dead jobs
 */
export async function requeueAllDead(): Promise<number> {
  const db = getDatabase();
  const now = Date.now();

  // Get all dead jobs
  const deadJobs = await db
    .selectFrom('processing_jobs')
    .selectAll()
    .where('status', '=', 'dead')
    .execute();

  if (deadJobs.length === 0) {
    return 0;
  }

  // Reset all to queued
  await db
    .updateTable('processing_jobs')
    .set({
      status: 'queued',
      attempts: 0,
      last_error: null,
      locked_by: null,
      locked_at: null,
      updated_at: now,
    })
    .where('status', '=', 'dead')
    .execute();

  // Log audit event for batch requeue
  await logAuditEvent({
    actor: 'user',
    action: 'jobs_requeued_bulk',
    metadata: {
      count: deadJobs.length,
      job_ids: deadJobs.map((j) => j.id),
    },
  });

  return deadJobs.length;
}

/**
 * Phase 12: List all dead jobs
 */
export async function listDeadJobs(): Promise<ProcessingJob[]> {
  return listJobs({ status: 'dead' });
}

/**
 * Check if any job of the given type is currently queued (not running, not done).
 * Used to prevent duplicate scheduler bootstrap jobs.
 *
 * Note: checks 'queued' only, not 'running', because the calling job is itself
 * 'running' when it checks — we only want to detect a separate queued successor.
 */
export async function hasQueuedJobOfType(jobType: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .selectFrom('processing_jobs')
    .select('id')
    .where('job_type', '=', jobType)
    .where('status', '=', 'queued')
    .executeTakeFirst();
  return !!result;
}

/**
 * Check if any job of the given type is currently queued or running for a specific entry.
 * Used by idle processing scanner to avoid double-queueing background jobs.
 */
export async function hasActiveJobForEntry(jobType: string, entryId: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .selectFrom('processing_jobs')
    .select('id')
    .where('job_type', '=', jobType)
    .where('entry_id', '=', entryId)
    .where('status', 'in', ['queued', 'running'])
    .executeTakeFirst();
  return !!result;
}

/**
 * Check if any job of the given type is currently queued for a specific pot.
 * Used to prevent duplicate fire-and-forget jobs (e.g. generate_nudges) when
 * multiple entries are captured in quick succession for the same pot.
 */
export async function hasQueuedJobForPot(jobType: string, potId: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .selectFrom('processing_jobs')
    .select('id')
    .where('job_type', '=', jobType)
    .where('pot_id', '=', potId)
    .where('status', '=', 'queued')
    .executeTakeFirst();
  return !!result;
}
