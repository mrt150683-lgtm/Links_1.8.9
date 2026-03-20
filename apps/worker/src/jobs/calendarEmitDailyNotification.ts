/**
 * calendar_emit_daily_notification Job Handler
 *
 * Selects ONE calendar item for today and writes a calendar_notifications row.
 * The DB UNIQUE(date_key) constraint ensures at most 1 notification per day,
 * even if the scheduler glitches and runs this job twice.
 *
 * Priority order:
 * 1. Manual events happening today → highest importance, then soonest
 * 2. Upcoming manual events in next 7 days → same sort
 * 3. Extracted calendar_entry_dates for today → highest confidence, then most recent
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getCalendarNotificationForDate,
  insertCalendarNotification,
  listCalendarEventsInRange,
  listEntryDatesForDate,
  getAIPreferences,
  todayDateKey,
  getSystemTimezone,
} from '@links/storage';

const logger = createLogger({ name: 'job:calendar-emit-daily-notification' });

export async function calendarEmitDailyNotificationHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId });

  const dateKey = ctx.payload?.date_key as string | undefined;
  if (!dateKey) {
    throw new Error('calendar_emit_daily_notification requires payload.date_key');
  }

  // Idempotency: if notification for today already exists, skip
  const existing = await getCalendarNotificationForDate(dateKey);
  if (existing) {
    logger.info({ job_id: ctx.jobId, date_key: dateKey, msg: 'Notification already exists — skipping' });
    return;
  }

  // Priority 1: manual events for today
  const todayEvents = await listCalendarEventsInRange(dateKey, dateKey);
  if (todayEvents.length > 0) {
    // Sort by importance desc, then start_at asc
    todayEvents.sort((a, b) => b.importance - a.importance || a.start_at - b.start_at);
    const picked = todayEvents[0]!;

    await insertCalendarNotification({
      date_key: dateKey,
      title: `Today: ${picked.title}`,
      body: picked.details ? picked.details.substring(0, 200) : picked.title,
      item_type: 'event',
      item_id: picked.id,
    });

    logger.info({ job_id: ctx.jobId, date_key: dateKey, item_type: 'event', msg: 'Emitted daily notification from today event' });
    return;
  }

  // Priority 2: upcoming events in next 7 days
  const now = new Date(dateKey + 'T12:00:00Z');
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const futureDateKey = sevenDaysLater.toISOString().substring(0, 10);
  const upcomingEvents = await listCalendarEventsInRange(dateKey, futureDateKey);
  // Filter out today (already checked above)
  const futureOnly = upcomingEvents.filter((e) => e.date_key > dateKey);

  if (futureOnly.length > 0) {
    futureOnly.sort((a, b) => b.importance - a.importance || a.start_at - b.start_at);
    const picked = futureOnly[0]!;

    await insertCalendarNotification({
      date_key: dateKey,
      title: `Upcoming: ${picked.title}`,
      body: `${picked.date_key} — ${picked.details ? picked.details.substring(0, 160) : picked.title}`,
      item_type: 'event',
      item_id: picked.id,
    });

    logger.info({ job_id: ctx.jobId, date_key: dateKey, item_type: 'event', msg: 'Emitted daily notification from upcoming event' });
    return;
  }

  // Priority 3: extracted calendar_entry_dates for today
  const entryDates = await listEntryDatesForDate(dateKey);
  if (entryDates.length > 0) {
    // Sort by confidence desc, then created_at desc (most recently linked)
    entryDates.sort((a, b) =>
      (b.confidence ?? 0) - (a.confidence ?? 0) || b.created_at - a.created_at
    );
    const picked = entryDates[0]!;

    const label = picked.label ?? 'Entry date';
    await insertCalendarNotification({
      date_key: dateKey,
      title: `Research: ${label}`,
      body: `Date mentioned in captured entry`,
      item_type: 'entry_date',
      item_id: picked.id,
    });

    logger.info({ job_id: ctx.jobId, date_key: dateKey, item_type: 'entry_date', msg: 'Emitted daily notification from entry date' });
    return;
  }

  logger.info({ job_id: ctx.jobId, date_key: dateKey, msg: 'No calendar items found — no notification emitted' });
}
