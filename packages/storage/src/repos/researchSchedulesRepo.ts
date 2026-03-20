/**
 * Research Schedules Repository
 *
 * Manages scheduled research runs (first-class table, separate from run instances).
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { ResearchSchedule, CreateResearchScheduleInput } from '../types.js';

function toSchedule(row: any): ResearchSchedule {
  return {
    id: row.id,
    pot_id: row.pot_id,
    enabled: row.enabled === 1,
    cron_like: row.cron_like ?? null,
    timezone: row.timezone,
    goal_prompt: row.goal_prompt,
    config: row.config_json ? JSON.parse(row.config_json) : {},
    auto_approve_plan: row.auto_approve_plan === 1,
    last_run_id: row.last_run_id ?? null,
    next_run_at: row.next_run_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Compute next run timestamp from cron_like string
 * Supported formats: "daily_at_HH:MM", "weekly_monday_HH:MM" etc.
 */
export function computeNextRunAt(cronLike: string | undefined, timezone: string): number | null {
  if (!cronLike) return null;

  const now = new Date();
  const [, timeStr] = cronLike.split('_at_');
  if (!timeStr) return null;

  const [hoursStr, minutesStr] = timeStr.split(':');
  const hours = parseInt(hoursStr ?? '0', 10);
  const minutes = parseInt(minutesStr ?? '0', 10);
  if (isNaN(hours) || isNaN(minutes)) return null;

  // Compute next occurrence (simplified: add 24h or 7 days)
  const isWeekly = cronLike.startsWith('weekly_');
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    // Already passed today — advance
    next.setDate(next.getDate() + (isWeekly ? 7 : 1));
  }

  return next.getTime();
}

/**
 * Get schedule for a pot (max 1 per pot via UNIQUE index)
 */
export async function getResearchSchedule(potId: string): Promise<ResearchSchedule | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('research_schedules')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  return row ? toSchedule(row) : null;
}

/**
 * Upsert schedule for a pot
 */
export async function upsertResearchSchedule(
  input: CreateResearchScheduleInput & { next_run_at?: number | null }
): Promise<ResearchSchedule> {
  const db = getDatabase();
  const now = Date.now();

  const existing = await db
    .selectFrom('research_schedules')
    .select('id')
    .where('pot_id', '=', input.pot_id)
    .executeTakeFirst();

  const id = existing?.id ?? randomUUID();
  const nextRunAt = input.next_run_at !== undefined
    ? input.next_run_at
    : computeNextRunAt(input.cron_like, input.timezone ?? 'UTC');

  if (existing) {
    await db
      .updateTable('research_schedules')
      .set({
        enabled: input.enabled ? 1 : 0,
        cron_like: input.cron_like ?? null,
        timezone: input.timezone ?? 'UTC',
        goal_prompt: input.goal_prompt,
        config_json: JSON.stringify(input.config ?? {}),
        auto_approve_plan: input.auto_approve_plan ? 1 : 0,
        next_run_at: nextRunAt,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  } else {
    await db
      .insertInto('research_schedules')
      .values({
        id,
        pot_id: input.pot_id,
        enabled: input.enabled ? 1 : 0,
        cron_like: input.cron_like ?? null,
        timezone: input.timezone ?? 'UTC',
        goal_prompt: input.goal_prompt,
        config_json: JSON.stringify(input.config ?? {}),
        auto_approve_plan: input.auto_approve_plan ? 1 : 0,
        last_run_id: null,
        next_run_at: nextRunAt,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  return toSchedule(
    await db.selectFrom('research_schedules').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
  );
}

/**
 * Update schedule after a run completes (last_run_id + next_run_at)
 */
export async function advanceResearchSchedule(
  potId: string,
  lastRunId: string
): Promise<void> {
  const db = getDatabase();
  const schedule = await getResearchSchedule(potId);
  if (!schedule) return;

  const nextRunAt = computeNextRunAt(schedule.cron_like ?? undefined, schedule.timezone);

  await db
    .updateTable('research_schedules')
    .set({
      last_run_id: lastRunId,
      next_run_at: nextRunAt,
      updated_at: Date.now(),
    })
    .where('pot_id', '=', potId)
    .execute();
}

/**
 * Delete a schedule for a pot
 */
export async function deleteResearchSchedule(potId: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('research_schedules').where('pot_id', '=', potId).execute();
}

/**
 * Get all enabled schedules that are due to run
 */
export async function getDueResearchSchedules(): Promise<ResearchSchedule[]> {
  const db = getDatabase();
  const now = Date.now();

  const rows = await db
    .selectFrom('research_schedules')
    .selectAll()
    .where('enabled', '=', 1)
    .where('next_run_at', '<=', now)
    .execute();

  return rows.map(toSchedule);
}
