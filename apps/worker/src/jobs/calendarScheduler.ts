/**
 * calendar_scheduler Job Handler
 *
 * Self-re-enqueuing scheduler that runs every ~60 seconds.
 * On each tick:
 *   1. Compute today's date_key in configured timezone
 *   2. If no notification for today, enqueue calendar_emit_daily_notification
 *   3. Re-enqueue itself with run_after = now + 60s
 *
 * Bootstrapped once on worker startup.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getCalendarNotificationForDate,
  getAIPreferences,
  enqueueJob,
  hasQueuedJobOfType,
  todayDateKey,
  getSystemTimezone,
} from '@links/storage';

const logger = createLogger({ name: 'job:calendar-scheduler' });

export async function calendarSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Calendar scheduler tick' });

  // Resolve timezone
  const prefs = await getAIPreferences();
  const tz = prefs.calendar_timezone ?? getSystemTimezone();
  const today = todayDateKey(tz);

  // Check if notification for today already exists
  const existing = await getCalendarNotificationForDate(today);
  if (!existing) {
    await enqueueJob({
      job_type: 'calendar_emit_daily_notification',
      priority: 30,
      payload: { date_key: today },
    });
    logger.info({ job_id: ctx.jobId, date_key: today, msg: 'Enqueued calendar_emit_daily_notification' });
  } else {
    logger.info({ job_id: ctx.jobId, date_key: today, msg: 'Notification already exists for today' });
  }

  // Self-re-enqueue in 10 minutes — only if no successor is already queued
  if (!(await hasQueuedJobOfType('calendar_scheduler'))) {
    await enqueueJob({
      job_type: 'calendar_scheduler',
      run_after: Date.now() + 600_000,
      priority: 5,
    });
  }
}
