/**
 * Nutrition Wellbeing Repository
 *
 * CRUD for nutrition_wellbeing_logs — one row per (pot_id, log_date).
 * Migration: 037_wellness.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  NutritionWellbeingLog,
  UpsertWellbeingLogInput,
} from '../types.js';

// ── Helper ────────────────────────────────────────────────────────────────

function toWellbeingLog(row: any): NutritionWellbeingLog {
  return {
    id: row.id,
    pot_id: row.pot_id,
    log_date: row.log_date,
    symptoms: JSON.parse(row.symptoms ?? '[]'),
    mood: row.mood,
    energy: row.energy,
    sleep_quality: row.sleep_quality,
    sleep_hours: row.sleep_hours,
    anxiety: row.anxiety,
    notes: row.notes,
    created_at: row.created_at as number,
    updated_at: row.updated_at,
  };
}

// ── Wellbeing Logs ────────────────────────────────────────────────────────

export async function upsertWellbeingLog(
  potId: string,
  logDate: string,
  data: UpsertWellbeingLogInput,
): Promise<NutritionWellbeingLog> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_wellbeing_logs')
    .values({
      id,
      pot_id: potId,
      log_date: logDate,
      symptoms: JSON.stringify(data.symptoms ?? []),
      mood: data.mood ?? null,
      energy: data.energy ?? null,
      sleep_quality: data.sleep_quality ?? null,
      sleep_hours: data.sleep_hours ?? null,
      anxiety: data.anxiety ?? null,
      notes: data.notes ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['pot_id', 'log_date']).doUpdateSet({
        symptoms: JSON.stringify(data.symptoms ?? []),
        mood: data.mood ?? null,
        energy: data.energy ?? null,
        sleep_quality: data.sleep_quality ?? null,
        sleep_hours: data.sleep_hours ?? null,
        anxiety: data.anxiety ?? null,
        notes: data.notes ?? null,
        updated_at: now,
      }),
    )
    .execute();

  const row = await db
    .selectFrom('nutrition_wellbeing_logs')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('log_date', '=', logDate)
    .executeTakeFirstOrThrow();

  return toWellbeingLog(row);
}

export async function getWellbeingLog(
  potId: string,
  logDate: string,
): Promise<NutritionWellbeingLog | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_wellbeing_logs')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('log_date', '=', logDate)
    .executeTakeFirst();
  return row ? toWellbeingLog(row) : undefined;
}

export async function listWellbeingLogs(
  potId: string,
  from: string,
  to: string,
): Promise<NutritionWellbeingLog[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_wellbeing_logs')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('log_date', '>=', from)
    .where('log_date', '<=', to)
    .orderBy('log_date', 'desc')
    .execute();
  return rows.map(toWellbeingLog);
}

export async function deleteWellbeingLog(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('nutrition_wellbeing_logs').where('id', '=', id).execute();
}
