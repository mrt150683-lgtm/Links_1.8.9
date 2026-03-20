/**
 * Onboarding Repository (030_dyk)
 *
 * Per-pot setup wizard state management.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { PotOnboarding, UpsertOnboardingInput } from '../types.js';

// ── Row mapper ────────────────────────────────────────────────────────────────

function toPotOnboarding(row: any): PotOnboarding {
  return {
    id: row.id,
    pot_id: row.pot_id,
    completed_at: row.completed_at ?? null,
    goal_text: row.goal_text ?? null,
    role_ref: row.role_ref ?? null,
    search_targets: JSON.parse(row.search_targets_json ?? '[]'),
    state: JSON.parse(row.state_json ?? '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function getOnboarding(potId: string): Promise<PotOnboarding | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('pot_onboarding')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();
  return row ? toPotOnboarding(row) : null;
}

export async function upsertOnboarding(
  potId: string,
  update: UpsertOnboardingInput,
): Promise<PotOnboarding> {
  const db = getDatabase();
  const now = Date.now();

  // Check if exists
  const existing = await db
    .selectFrom('pot_onboarding')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('pot_onboarding')
      .set({
        goal_text: update.goal_text !== undefined ? update.goal_text : existing.goal_text,
        role_ref: update.role_ref !== undefined ? update.role_ref : existing.role_ref,
        search_targets_json: update.search_targets !== undefined
          ? JSON.stringify(update.search_targets)
          : existing.search_targets_json,
        state_json: update.state !== undefined
          ? JSON.stringify(update.state)
          : existing.state_json,
        completed_at: update.completed_at !== undefined
          ? update.completed_at
          : existing.completed_at,
        updated_at: now,
      })
      .where('pot_id', '=', potId)
      .execute();
  } else {
    const id = randomUUID();
    await db.insertInto('pot_onboarding').values({
      id,
      pot_id: potId,
      completed_at: update.completed_at ?? null,
      goal_text: update.goal_text ?? null,
      role_ref: update.role_ref ?? null,
      search_targets_json: JSON.stringify(update.search_targets ?? []),
      state_json: JSON.stringify(update.state ?? {}),
      created_at: now,
      updated_at: now,
    }).execute();
  }

  const row = await db
    .selectFrom('pot_onboarding')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirstOrThrow();

  return toPotOnboarding(row);
}

export async function completeOnboarding(
  potId: string,
  data: { goal_text: string; role_ref?: string; search_targets: string[] },
): Promise<PotOnboarding> {
  const db = getDatabase();
  const now = Date.now();

  // Write to pot_onboarding
  const onboarding = await upsertOnboarding(potId, {
    goal_text: data.goal_text,
    role_ref: data.role_ref,
    search_targets: data.search_targets,
    completed_at: now,
  });

  // Also write to pots table
  await db
    .updateTable('pots')
    .set({
      goal_text: data.goal_text,
      search_targets_json: JSON.stringify(data.search_targets),
      updated_at: now,
    })
    .where('id', '=', potId)
    .execute();

  return onboarding;
}
