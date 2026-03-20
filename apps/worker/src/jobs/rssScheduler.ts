/**
 * rss_scheduler Job Handler
 *
 * Self-re-enqueuing scheduler (15-min ticks) that:
 * 1. Checks if RSS module is enabled
 * 2. Checks if it's time to run the daily collection (configurable, default 06:00)
 * 3. Re-enqueues itself
 *
 * Bootstrapped on worker startup.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getRssSettings,
  enqueueJob,
  hasQueuedJobOfType,
  getSystemTimezone,
} from '@links/storage';

const logger = createLogger({ name: 'job:rss-scheduler' });

/**
 * Get local hour and minute in the given timezone.
 */
function getLocalHourMinute(date: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

/**
 * Format date as YYYY-MM-DD in UTC (used to track if collection ran today).
 */
function toDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Track last collection date (in-memory; resets on worker restart — that's OK)
let lastCollectionDateKey: string | null = null;

export async function rssSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'RSS scheduler tick' });

  const settings = await getRssSettings();

  if (!settings.enabled) {
    logger.info({ job_id: ctx.jobId, msg: 'RSS module disabled, skipping' });
    await reEnqueue();
    return;
  }

  // Resolve timezone
  const tz = getSystemTimezone() ?? 'UTC';
  const now = new Date();
  const { hour, minute } = getLocalHourMinute(now, tz);
  const todayKey = toDateKey(now);

  // Parse configured collect time (HH:MM)
  const [collectHStr, collectMStr] = (settings.collect_time ?? '06:00').split(':');
  const collectHour = Number(collectHStr ?? 6);
  const collectMinute = Number(collectMStr ?? 0);

  // Trigger collection if within the configured minute window and not yet done today
  const inWindow = hour === collectHour && minute >= collectMinute && minute < collectMinute + 15;
  const alreadyRanToday = lastCollectionDateKey === todayKey;

  if (inWindow && !alreadyRanToday) {
    const alreadyQueued = await hasQueuedJobOfType('rss_collector');
    if (!alreadyQueued) {
      logger.info({ job_id: ctx.jobId, msg: 'Enqueuing RSS collector' });
      await enqueueJob({
        job_type: 'rss_collector',
        payload: {},
        priority: 20,
      });
      lastCollectionDateKey = todayKey;
    }
  }

  await reEnqueue();
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('rss_scheduler'))) {
    await enqueueJob({
      job_type: 'rss_scheduler',
      run_after: Date.now() + 900_000, // 15 min
      priority: 5,
    });
  }
}
