/**
 * nutrition_scheduler Job Handler
 *
 * Self-re-enqueuing scheduler (15-min ticks) that:
 * 1. Ensures diet pot exists
 * 2. Checks if daily review should run (23:50-23:59 local time)
 * 3. Checks if weekly review should run (check-in submitted but no review yet)
 * 4. Re-enqueues itself
 *
 * Bootstrapped on worker startup.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getDietPotId,
  getNutritionProfile,
  getDailyReview,
  getWeeklyCheckIn,
  getWeeklyReview,
  enqueueJob,
  hasQueuedJobOfType,
  getSystemTimezone,
} from '@links/storage';

const logger = createLogger({ name: 'job:nutrition-scheduler' });

/**
 * Format date as YYYY-MM-DD in the given timezone.
 */
function toLocalDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts; // en-CA locale gives YYYY-MM-DD
}

/**
 * Compute ISO week key as YYYY-WNN.
 */
function toWeekKey(date: Date, tz: string): string {
  // Compute Thursday of the current week (ISO week definition)
  const localStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const [year, month, day] = localStr.split('-').map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day!));

  // Get ISO week day (1=Mon, 7=Sun)
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Set to Thursday of the week
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

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

export async function nutritionSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Nutrition scheduler tick' });

  // 1. Check diet pot
  const pot_id = await getDietPotId();
  if (!pot_id) {
    logger.info({ job_id: ctx.jobId, msg: 'No diet pot configured, skipping' });
    await reEnqueue();
    return;
  }

  // 2. Resolve timezone — fall back to UTC if stored value is invalid
  const profile = await getNutritionProfile();
  const rawTz = profile.timezone ?? getSystemTimezone();
  let tz = rawTz;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: rawTz });
  } catch {
    logger.warn({ job_id: ctx.jobId, raw_tz: rawTz, msg: 'Invalid timezone in profile, falling back to UTC' });
    tz = 'UTC';
  }

  const now = new Date();
  const { hour, minute } = getLocalHourMinute(now, tz);
  const todayKey = toLocalDateKey(now, tz);
  const weekKey = toWeekKey(now, tz);

  // 3. Daily review: trigger at 23:50-23:59 if not yet created
  if (hour === 23 && minute >= 50) {
    const existing = await getDailyReview(pot_id, todayKey);
    if (!existing) {
      logger.info({ job_id: ctx.jobId, date_key: todayKey, msg: 'Enqueuing daily review' });
      await enqueueJob({
        job_type: 'nutrition_daily_review',
        pot_id,
        payload: { date_key: todayKey, pot_id },
        priority: 30,
      });
    }
  }

  // 4. Weekly review: if check-in submitted but no review yet
  const checkIn = await getWeeklyCheckIn(pot_id, weekKey);
  if (checkIn) {
    const weeklyReview = await getWeeklyReview(pot_id, weekKey);
    if (!weeklyReview) {
      const alreadyQueued = await hasQueuedJobOfType('nutrition_weekly_review');
      if (!alreadyQueued) {
        logger.info({ job_id: ctx.jobId, week_key: weekKey, msg: 'Enqueuing weekly review' });
        await enqueueJob({
          job_type: 'nutrition_weekly_review',
          pot_id,
          payload: { week_key: weekKey, pot_id, check_in_id: checkIn.id },
          priority: 25,
        });
      }
    }
  }

  // 5. Self-re-enqueue in 15 minutes
  await reEnqueue();
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('nutrition_scheduler'))) {
    await enqueueJob({
      job_type: 'nutrition_scheduler',
      run_after: Date.now() + 900_000, // 15 min
      priority: 5,
    });
  }
}
