import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import { logAuditEvent } from './auditRepo.js';
import type { Pot, CreatePotInput, UpdatePotInput } from '../types.js';

/**
 * Map a raw DB row to the Pot domain type.
 * Parses search_targets_json → search_targets array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPot(row: any): Pot {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    security_level: row.security_level,
    created_at: row.created_at as unknown as number,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    role_ref: row.role_ref,
    role_hash: row.role_hash,
    role_updated_at: row.role_updated_at,
    goal_text: row.goal_text ?? null,
    search_targets: row.search_targets_json ? JSON.parse(row.search_targets_json) : [],
  };
}

/**
 * Create a new pot
 */
export async function createPot(input: CreatePotInput): Promise<Pot> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db.insertInto('pots').values({
    id,
    name: input.name,
    description: input.description ?? null,
    security_level: 'standard',
    created_at: now,
    updated_at: now,
    last_used_at: null,
    role_ref: null,
    role_hash: null,
    role_updated_at: null,
  }).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'user',
    action: 'create_pot',
    pot_id: id,
    metadata: { name: input.name },
  });

  return {
    id,
    name: input.name,
    description: input.description ?? null,
    security_level: 'standard',
    created_at: now,
    updated_at: now,
    last_used_at: null,
    role_ref: null,
    role_hash: null,
    role_updated_at: null,
    goal_text: null,
    search_targets: [],
  };
}

/**
 * Get a pot by ID
 */
export async function getPotById(id: string): Promise<Pot | null> {
  const db = getDatabase();

  const row = await db.selectFrom('pots').selectAll().where('id', '=', id).executeTakeFirst();

  return row ? toPot(row) : null;
}

/**
 * List all pots
 */
export async function listPots(limit: number = 100, offset: number = 0): Promise<Pot[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('pots')
    .selectAll()
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map(toPot);
}

/**
 * Update a pot
 */
export async function updatePot(id: string, input: UpdatePotInput): Promise<Pot | null> {
  const db = getDatabase();
  const now = Date.now();

  // Check if pot exists
  const existing = await getPotById(id);
  if (!existing) {
    return null;
  }

  const updates: { updated_at: number; name?: string; description?: string | null } = {
    updated_at: now,
  };

  if (input.name !== undefined) {
    updates.name = input.name;
  }
  if (input.description !== undefined) {
    updates.description = input.description;
  }

  await db.updateTable('pots').set(updates).where('id', '=', id).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'user',
    action: 'update_pot',
    pot_id: id,
    metadata: input as Record<string, unknown>,
  });

  return getPotById(id);
}

/**
 * Delete a pot (cascades to entries)
 */
export async function deletePot(id: string): Promise<boolean> {
  const db = getDatabase();

  // Check if pot exists
  const existing = await getPotById(id);
  if (!existing) {
    return false;
  }

  // Log audit event before deletion
  await logAuditEvent({
    actor: 'user',
    action: 'delete_pot',
    pot_id: id,
    metadata: { name: existing.name },
  });

  const result = await db.deleteFrom('pots').where('id', '=', id).executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * Count total pots
 */
export async function countPots(): Promise<number> {
  const db = getDatabase();

  const result = await db
    .selectFrom('pots')
    .select((eb) => eb.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  return result?.count ?? 0;
}

/**
 * Phase 3: Update last_used_at timestamp for a pot
 */
export async function touchLastUsed(potId: string, timestamp: number): Promise<void> {
  const db = getDatabase();

  await db.updateTable('pots').set({ last_used_at: timestamp }).where('id', '=', potId).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'pot_last_used_updated',
    pot_id: potId,
    metadata: { timestamp },
  });
}

/**
 * Agent roles (018_pot_role): Update role reference and hash for a pot.
 */
export async function updatePotRole(
  potId: string,
  role: { role_ref: string; role_hash: string; role_updated_at: number }
): Promise<Pot | null> {
  const db = getDatabase();

  const existing = await getPotById(potId);
  if (!existing) {
    return null;
  }

  await db
    .updateTable('pots')
    .set({
      role_ref: role.role_ref,
      role_hash: role.role_hash,
      role_updated_at: role.role_updated_at,
      updated_at: Date.now(),
    })
    .where('id', '=', potId)
    .execute();

  await logAuditEvent({
    actor: 'user',
    action: 'pot_role_updated',
    pot_id: potId,
    metadata: { role_ref: role.role_ref, role_hash: role.role_hash },
  });

  return getPotById(potId);
}

/**
 * Phase 3: List pots for capture popup (sorted by recent usage)
 */
export async function listPotsForCapture(limit: number = 20): Promise<Pot[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('pots')
    .selectAll()
    .orderBy('last_used_at', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map(toPot);
}
