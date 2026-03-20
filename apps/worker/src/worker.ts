/**
 * Core worker logic - Job processing loop
 * Phase 5: Processing Engine
 */

import os from 'node:os';
import process from 'node:process';
import type { Config } from '@links/config';
import { createLogger } from '@links/logging';
import {
  claimNextJob,
  getJobHandler,
  markJobDone,
  markJobFailed,
  writeJobLog,
  type ProcessingJob,
} from '@links/storage';
import { isProcessingAllowed, loadIdlePolicyConfig } from './idle-policy.js';

const logger = createLogger({ name: 'worker' });

export interface WorkerConfig {
  workerId: string;
  lockTimeoutMs: number; // Reclaim jobs locked longer than this
  pollIntervalMs: number; // How long to sleep when queue is empty
  maxConcurrentJobs: number; // Phase 5: always 1 (future: parallel workers)
}

export interface WorkerStats {
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  startedAt: number;
}

/**
 * Generate unique worker ID
 */
export function generateWorkerId(): string {
  const hostname = os.hostname();
  const pid = process.pid;
  const random = Math.random().toString(36).substring(2, 8);
  return `${hostname}-${pid}-${random}`;
}

/**
 * Default worker configuration
 */
export function getDefaultWorkerConfig(): WorkerConfig {
  return {
    workerId: generateWorkerId(),
    lockTimeoutMs: 10 * 60 * 1000, // 10 minutes
    pollIntervalMs: 5000, // 5 seconds
    maxConcurrentJobs: 1, // Phase 5: process one job at a time
  };
}

/**
 * Process a single job
 *
 * @param job - Job to process
 * @param workerId - Worker identifier
 * @returns true if successful, false if failed
 */
export async function processJob(job: ProcessingJob, workerId: string): Promise<boolean> {
  const startTime = Date.now();

  logger.info({
    job_id: job.id,
    job_type: job.job_type,
    pot_id: job.pot_id,
    entry_id: job.entry_id,
    attempt: job.attempts,
    worker_id: workerId,
    msg: 'Job started',
  });

  await writeJobLog(job.id, 'info', 'Job started', {
    attempt: job.attempts,
    worker_id: workerId,
  });

  try {
    // Get handler for this job type
    const handler = getJobHandler(job.job_type);
    if (!handler) {
      throw new Error(`Unknown job type: ${job.job_type}`);
    }

    // Execute job
    await handler({
      jobId: job.id,
      potId: job.pot_id,
      entryId: job.entry_id,
      attempt: job.attempts,
      payload: job.payload,
      flowId: job.flow_id ?? null,
    });

    // Mark as done
    await markJobDone(job.id);

    const duration = Date.now() - startTime;

    logger.info({
      job_id: job.id,
      job_type: job.job_type,
      pot_id: job.pot_id,
      entry_id: job.entry_id,
      attempt: job.attempts,
      duration_ms: duration,
      worker_id: workerId,
      msg: 'Job succeeded',
    });

    await writeJobLog(job.id, 'info', 'Job succeeded', {
      duration_ms: duration,
    });

    return true;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;

    logger.error({
      job_id: job.id,
      job_type: job.job_type,
      pot_id: job.pot_id,
      entry_id: job.entry_id,
      attempt: job.attempts,
      duration_ms: duration,
      worker_id: workerId,
      error_class: err.constructor.name,
      error_message: err.message,
      msg: 'Job failed',
    });

    await writeJobLog(job.id, 'error', 'Job failed', {
      duration_ms: duration,
      error_class: err.constructor.name,
      error_message: err.message,
      error_stack: err.stack?.substring(0, 500),
    });

    // Mark as failed (will retry or deadletter)
    await markJobFailed(job.id, err);

    return false;
  }
}

/**
 * Run worker once (claim and process one job, then exit)
 * Used for testing and smoke scripts
 *
 * @param config - Application configuration
 * @param workerConfig - Worker configuration
 * @returns true if a job was processed, false if queue was empty
 */
export async function runWorkerOnce(
  config: Config,
  workerConfig: WorkerConfig = getDefaultWorkerConfig(),
): Promise<boolean> {
  const now = Date.now();

  logger.info({
    worker_id: workerConfig.workerId,
    mode: 'once',
    msg: 'Worker started (run-once mode)',
  });

  // Claim next job
  const result = await claimNextJob(workerConfig.workerId, now, workerConfig.lockTimeoutMs);

  if (!result) {
    logger.info({ msg: 'No jobs available' });
    return false;
  }

  const { job, isReclaim } = result;

  if (isReclaim) {
    logger.warn({
      job_id: job.id,
      job_type: job.job_type,
      locked_by: job.locked_by,
      locked_at: job.locked_at,
      msg: 'Reclaimed stale job',
    });
  }

  // Process job
  const success = await processJob(job, workerConfig.workerId);

  logger.info({
    worker_id: workerConfig.workerId,
    job_id: job.id,
    success,
    msg: 'Worker finished (run-once mode)',
  });

  return success;
}

/**
 * Run worker in daemon mode (continuous processing loop)
 *
 * @param config - Application configuration
 * @param workerConfig - Worker configuration
 * @param signal - AbortSignal for graceful shutdown
 */
export async function runWorkerDaemon(
  config: Config,
  workerConfig: WorkerConfig = getDefaultWorkerConfig(),
  signal?: AbortSignal,
): Promise<WorkerStats> {
  const stats: WorkerStats = {
    jobsProcessed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    startedAt: Date.now(),
  };

  const idlePolicy = loadIdlePolicyConfig(config);

  logger.info({
    worker_id: workerConfig.workerId,
    mode: 'daemon',
    idle_enabled: idlePolicy.enabled,
    idle_only: idlePolicy.idleOnly,
    run_window_start: idlePolicy.runWindowStart,
    run_window_end: idlePolicy.runWindowEnd,
    msg: 'Worker started (daemon mode)',
  });

  // Processing loop
  while (!signal?.aborted) {
    const now = Date.now();

    // Check idle policy
    const allowed = await isProcessingAllowed(idlePolicy, now);
    if (!allowed) {
      logger.debug({ msg: 'Processing not allowed (idle policy)' });
      await sleep(workerConfig.pollIntervalMs);
      continue;
    }

    // Claim next job
    const result = await claimNextJob(workerConfig.workerId, now, workerConfig.lockTimeoutMs);

    if (!result) {
      // No jobs available, sleep and retry
      logger.debug({ msg: 'No jobs available, sleeping' });
      await sleep(workerConfig.pollIntervalMs);
      continue;
    }

    const { job, isReclaim } = result;

    if (isReclaim) {
      logger.warn({
        job_id: job.id,
        job_type: job.job_type,
        locked_by: job.locked_by,
        locked_at: job.locked_at,
        msg: 'Reclaimed stale job',
      });
    }

    // Process job
    const success = await processJob(job, workerConfig.workerId);

    stats.jobsProcessed++;
    if (success) {
      stats.jobsSucceeded++;
    } else {
      stats.jobsFailed++;
    }

    // Log stats periodically
    if (stats.jobsProcessed % 10 === 0) {
      logger.info({
        worker_id: workerConfig.workerId,
        jobs_processed: stats.jobsProcessed,
        jobs_succeeded: stats.jobsSucceeded,
        jobs_failed: stats.jobsFailed,
        uptime_ms: now - stats.startedAt,
        msg: 'Worker stats',
      });
    }
  }

  logger.info({
    worker_id: workerConfig.workerId,
    jobs_processed: stats.jobsProcessed,
    jobs_succeeded: stats.jobsSucceeded,
    jobs_failed: stats.jobsFailed,
    uptime_ms: Date.now() - stats.startedAt,
    msg: 'Worker stopped (daemon mode)',
  });

  return stats;
}

/**
 * Sleep for specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
