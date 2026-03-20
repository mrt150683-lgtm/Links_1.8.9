/**
 * automation_daily_reconcile Job Handler
 *
 * Daily cleanup and reconciliation:
 * 1. Release stale task locks (locked > 30min ago)
 * 2. Re-enqueue itself for next midnight
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  hasQueuedJobOfType,
  releaseStaleTaskLocks,
  logAuditEvent,
  getSystemTimezone,
} from '@links/storage';

const logger = createLogger({ name: 'job:automation-daily-reconcile' });

const STALE_LOCK_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export async function automationDailyReconcileHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Automation daily reconcile start' });

  // Release stale locks
  const released = await releaseStaleTaskLocks(STALE_LOCK_MAX_AGE_MS).catch((err) => {
    logger.warn({ err: String(err), msg: 'Failed to release stale locks — non-fatal' });
    return 0;
  });

  if (released > 0) {
    logger.info({ released, msg: 'Released stale task locks' });
    await logAuditEvent({
      actor: 'system',
      action: 'automation_stale_locks_released',
      metadata: { count: released },
    });
  }

  logger.info({ msg: 'Automation daily reconcile complete' });

  // Re-enqueue for next midnight
  await reEnqueueAtMidnight();
}

async function reEnqueueAtMidnight(): Promise<void> {
  if (await hasQueuedJobOfType('automation_daily_reconcile')) return;

  const tz = getSystemTimezone() ?? 'UTC';
  const nextMidnight = getNextMidnightMs(tz);

  await enqueueJob({
    job_type: 'automation_daily_reconcile',
    run_after: nextMidnight,
    priority: 3,
  });
}

function getNextMidnightMs(tz: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? now.getFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 1) - 1;
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? now.getDate());

  const tzOffset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
  const todayMidnightMs = Date.UTC(year, month, day) - tzOffset;
  const tomorrowMidnightMs = todayMidnightMs + 24 * 60 * 60 * 1000;

  return tomorrowMidnightMs;
}
