/**
 * Nutrition Supplement Repository
 *
 * Manages the supplement catalog (nutrition_supplements) and daily entries
 * (nutrition_supplement_entries).
 * Migration: 037_wellness.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  NutritionSupplement,
  NutritionSupplementEntry,
  CreateNutritionSupplementInput,
  CreateNutritionSupplementEntryInput,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toSupplement(row: any): NutritionSupplement {
  return {
    id: row.id,
    pot_id: row.pot_id,
    name: row.name,
    default_dose: row.default_dose,
    dose_unit: row.dose_unit,
    notes: row.notes,
    is_active: row.is_active === 1,
    created_at: row.created_at as number,
    updated_at: row.updated_at,
  };
}

function toSupplementEntry(row: any): NutritionSupplementEntry {
  return {
    id: row.id,
    pot_id: row.pot_id,
    supplement_id: row.supplement_id,
    entry_date: row.entry_date,
    entry_time: row.entry_time,
    dose: row.dose,
    dose_unit: row.dose_unit,
    meal_type: row.meal_type,
    notes: row.notes,
    created_at: row.created_at as number,
  };
}

// ── Supplement Catalog ────────────────────────────────────────────────────

export async function createSupplement(
  input: CreateNutritionSupplementInput,
): Promise<NutritionSupplement> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_supplements')
    .values({
      id,
      pot_id: input.pot_id,
      name: input.name,
      default_dose: input.default_dose ?? null,
      dose_unit: input.dose_unit ?? null,
      notes: input.notes ?? null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    name: input.name,
    default_dose: input.default_dose ?? null,
    dose_unit: input.dose_unit ?? null,
    notes: input.notes ?? null,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export interface UpdateSupplementInput {
  name?: string;
  default_dose?: number | null;
  dose_unit?: string | null;
  notes?: string | null;
}

export async function updateSupplement(
  id: string,
  patch: UpdateSupplementInput,
): Promise<NutritionSupplement> {
  const db = getDatabase();
  const now = Date.now();

  const updates: Record<string, unknown> = { updated_at: now };
  if (patch.name !== undefined) updates['name'] = patch.name;
  if (patch.default_dose !== undefined) updates['default_dose'] = patch.default_dose;
  if (patch.dose_unit !== undefined) updates['dose_unit'] = patch.dose_unit;
  if (patch.notes !== undefined) updates['notes'] = patch.notes;

  await db.updateTable('nutrition_supplements').set(updates).where('id', '=', id).execute();

  const row = await db
    .selectFrom('nutrition_supplements')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toSupplement(row);
}

export async function getSupplement(id: string): Promise<NutritionSupplement | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_supplements')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toSupplement(row) : undefined;
}

export async function listSupplements(
  potId: string,
  activeOnly = false,
): Promise<NutritionSupplement[]> {
  const db = getDatabase();
  let query = db.selectFrom('nutrition_supplements').selectAll().where('pot_id', '=', potId);
  if (activeOnly) {
    query = query.where('is_active', '=', 1);
  }
  const rows = await query.orderBy('name', 'asc').execute();
  return rows.map(toSupplement);
}

export async function deactivateSupplement(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('nutrition_supplements')
    .set({ is_active: 0, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

// ── Supplement Entries ────────────────────────────────────────────────────

export async function createSupplementEntry(
  input: CreateNutritionSupplementEntryInput,
): Promise<NutritionSupplementEntry> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_supplement_entries')
    .values({
      id,
      pot_id: input.pot_id,
      supplement_id: input.supplement_id,
      entry_date: input.entry_date,
      entry_time: input.entry_time ?? null,
      dose: input.dose ?? null,
      dose_unit: input.dose_unit ?? null,
      meal_type: input.meal_type ?? null,
      notes: input.notes ?? null,
      created_at: now,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    supplement_id: input.supplement_id,
    entry_date: input.entry_date,
    entry_time: input.entry_time ?? null,
    dose: input.dose ?? null,
    dose_unit: input.dose_unit ?? null,
    meal_type: input.meal_type ?? null,
    notes: input.notes ?? null,
    created_at: now,
  };
}

export async function listSupplementEntries(
  potId: string,
  dateKey: string,
): Promise<NutritionSupplementEntry[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_supplement_entries')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('entry_date', '=', dateKey)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toSupplementEntry);
}

export async function listSupplementEntriesByRange(
  potId: string,
  from: string,
  to: string,
): Promise<NutritionSupplementEntry[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_supplement_entries')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('entry_date', '>=', from)
    .where('entry_date', '<=', to)
    .orderBy('entry_date', 'desc')
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toSupplementEntry);
}

export async function deleteSupplementEntry(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('nutrition_supplement_entries').where('id', '=', id).execute();
}

export interface SupplementStackSummary {
  name: string;
  dose_unit: string | null;
  entry_count: number;
  avg_dose: number | null;
}

export async function getRecentSupplementStack(
  potId: string,
  days: number,
): Promise<SupplementStackSummary[]> {
  const db = getDatabase();
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  // Join entries with supplement names, group by supplement
  // Note: no table aliases — SQLite requires the same name used in FROM/JOIN
  // when referenced inside aggregate functions.
  const rows = await db
    .selectFrom('nutrition_supplement_entries')
    .innerJoin(
      'nutrition_supplements',
      'nutrition_supplements.id',
      'nutrition_supplement_entries.supplement_id',
    )
    .select([
      'nutrition_supplements.name',
      'nutrition_supplement_entries.dose_unit',
      db.fn.count<number>('nutrition_supplement_entries.id').as('entry_count'),
      db.fn.avg<number>('nutrition_supplement_entries.dose').as('avg_dose'),
    ])
    .where('nutrition_supplement_entries.pot_id', '=', potId)
    .where('nutrition_supplement_entries.entry_date', '>=', fromDate)
    .where('nutrition_supplement_entries.entry_date', '<=', toDate)
    .groupBy(['nutrition_supplements.name', 'nutrition_supplement_entries.dose_unit'])
    .orderBy('entry_count', 'desc')
    .execute();

  return rows.map((r) => ({
    name: r.name,
    dose_unit: r.dose_unit,
    entry_count: Number(r.entry_count),
    avg_dose: r.avg_dose != null ? Number(r.avg_dose) : null,
  }));
}
