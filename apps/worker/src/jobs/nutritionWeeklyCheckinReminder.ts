/**
 * nutrition_weekly_checkin_reminder Job Handler
 *
 * Lightweight job that creates a notification reminding the user
 * to submit their weekly check-in.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import { createMainChatNotification } from '@links/storage';

const logger = createLogger({ name: 'job:nutrition-checkin-reminder' });

export async function nutritionWeeklyCheckinReminderHandler(ctx: JobContext): Promise<void> {
  const { jobId, payload } = ctx;
  const { week_key } = (payload as any) ?? {};

  logger.info({ job_id: jobId, week_key, msg: 'Sending weekly check-in reminder' });

  await createMainChatNotification({
    type: 'reminder',
    title: 'Weekly Nutrition Check-In',
    preview: `Log your weight and weekly rating for ${week_key ?? 'this week'} to get your weekly nutrition review.`,
  });

  logger.info({ job_id: jobId, week_key, msg: 'Check-in reminder notification created' });
}
