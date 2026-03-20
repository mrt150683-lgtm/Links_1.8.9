import { getDatabase } from '../db.js';
import type { CapturePreferences, AiPreferences, LoggingPreferences } from '../types.js';

/**
 * Phase 3: User preferences repository
 *
 * Manages capture preferences stored in user_prefs table as key-value JSON.
 */

const PREFS_PREFIX = 'capture.';
const KEY_DEFAULT_POT = `${PREFS_PREFIX}default_pot_id`;
const KEY_LAST_POT = `${PREFS_PREFIX}last_pot_id`;
const KEY_AUTOSAVE = `${PREFS_PREFIX}autosave`;
const KEY_POPUP = `${PREFS_PREFIX}popup`;

/**
 * Get a generic preference value by key
 * Phase 5: Generic key-value preference access
 */
export async function getPreference<T = unknown>(key: string): Promise<T | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('user_prefs')
    .selectAll()
    .where('key', '=', key)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return JSON.parse(row.value_json) as T;
}

/**
 * Set a generic preference value by key
 * Phase 5: Generic key-value preference access
 */
export async function setPreference<T = unknown>(key: string, value: T): Promise<void> {
  const db = getDatabase();

  if (value === null || value === undefined) {
    // Delete preference if value is null/undefined
    await db.deleteFrom('user_prefs').where('key', '=', key).execute();
    return;
  }

  await db
    .insertInto('user_prefs')
    .values({
      key,
      value_json: JSON.stringify(value),
    })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value_json: JSON.stringify(value),
      }),
    )
    .execute();
}

/**
 * Get all capture preferences
 */
export async function getCapturePrefs(): Promise<CapturePreferences> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('user_prefs')
    .selectAll()
    .where('key', 'like', `${PREFS_PREFIX}%`)
    .execute();

  const prefs: CapturePreferences = {};

  for (const row of rows) {
    const value = JSON.parse(row.value_json);

    if (row.key === KEY_DEFAULT_POT) {
      prefs.default_pot_id = value.pot_id;
    } else if (row.key === KEY_LAST_POT) {
      prefs.last_pot_id = value.pot_id;
    } else if (row.key === KEY_AUTOSAVE) {
      prefs.autosave = value;
    } else if (row.key === KEY_POPUP) {
      prefs.popup = value;
    }
  }

  return prefs;
}

/**
 * Update capture preferences (PATCH-like merge behavior)
 */
export async function setCapturePrefsPatch(
  patch: CapturePreferences
): Promise<CapturePreferences> {
  const db = getDatabase();
  // Read existing preferences first
  const existing = await getCapturePrefs();

  // Merge patch into existing
  if (patch.default_pot_id !== undefined) {
    await db
      .insertInto('user_prefs')
      .values({
        key: KEY_DEFAULT_POT,
        value_json: JSON.stringify({ pot_id: patch.default_pot_id }),
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value_json: JSON.stringify({ pot_id: patch.default_pot_id }),
        })
      )
      .execute();
    existing.default_pot_id = patch.default_pot_id;
  }

  if (patch.last_pot_id !== undefined) {
    await db
      .insertInto('user_prefs')
      .values({
        key: KEY_LAST_POT,
        value_json: JSON.stringify({ pot_id: patch.last_pot_id }),
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value_json: JSON.stringify({ pot_id: patch.last_pot_id }),
        })
      )
      .execute();
    existing.last_pot_id = patch.last_pot_id;
  }

  if (patch.autosave !== undefined) {
    // Deep merge pot_overrides
    const merged = {
      enabled: patch.autosave.enabled,
      pot_overrides: {
        ...(existing.autosave?.pot_overrides || {}),
        ...(patch.autosave.pot_overrides || {}),
      },
    };
    await db
      .insertInto('user_prefs')
      .values({
        key: KEY_AUTOSAVE,
        value_json: JSON.stringify(merged),
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value_json: JSON.stringify(merged),
        })
      )
      .execute();
    existing.autosave = merged;
  }

  if (patch.popup !== undefined) {
    const merged = {
      ...(existing.popup || {}),
      ...patch.popup,
    };
    await db
      .insertInto('user_prefs')
      .values({
        key: KEY_POPUP,
        value_json: JSON.stringify(merged),
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value_json: JSON.stringify(merged),
        })
      )
      .execute();
    existing.popup = merged;
  }

  return existing;
}

/**
 * Check if autosave is enabled for a given pot
 */
export async function isAutosaveEnabled(potId: string): Promise<boolean> {
  const prefs = await getCapturePrefs();

  // Check pot-specific override first
  if (prefs.autosave?.pot_overrides?.[potId] !== undefined) {
    return prefs.autosave.pot_overrides[potId];
  }

  // Fall back to global setting
  return prefs.autosave?.enabled ?? false;
}

/**
 * Phase 5: Force run override for worker
 *
 * Set "run now" override (forces processing for specified duration)
 *
 * @param minutes - Duration in minutes to force processing
 * @returns Timestamp when override expires (epoch ms)
 */
export async function setForceRunNow(minutes: number): Promise<number> {
  const now = Date.now();
  const until = now + minutes * 60 * 1000;

  await setPreference('worker.force_run_until', until);

  return until;
}

/**
 * Phase 5: Get "run now" override expiry timestamp
 *
 * @returns Expiry timestamp or null if not set/expired
 */
export async function getForceRunUntil(): Promise<number | null> {
  const pref = await getPreference<number>('worker.force_run_until');

  if (!pref) {
    return null;
  }

  const now = Date.now();
  if (pref < now) {
    // Expired, clear it
    await clearForceRunNow();
    return null;
  }

  return pref;
}

/**
 * Phase 5: Clear "run now" override
 */
export async function clearForceRunNow(): Promise<void> {
  await setPreference('worker.force_run_until', null);
}

/**
 * Phase 6/7: Get AI preferences
 */
export async function getAIPreferences(): Promise<AiPreferences> {
  const prefs = await getPreference<AiPreferences>('ai.preferences');
  return prefs || {};
}

/**
 * Phase 5: Get idle processing preferences
 */
export async function getIdlePrefs(): Promise<{
  enabled: boolean;
  idle_only: boolean;
  run_window_start?: string;
  run_window_end?: string;
  pot_ids?: string[];
}> {
  const prefs = await getPreference<{
    enabled?: boolean;
    idle_only?: boolean;
    run_window_start?: string;
    run_window_end?: string;
    pot_ids?: string[];
  }>('idle.preferences');

  return {
    enabled: prefs?.enabled ?? false,
    idle_only: prefs?.idle_only ?? false,
    run_window_start: prefs?.run_window_start,
    run_window_end: prefs?.run_window_end,
    pot_ids: prefs?.pot_ids,
  };
}

/**
 * Phase 5: Set idle processing preferences
 */
export async function setIdlePrefs(patch: {
  enabled?: boolean;
  idle_only?: boolean;
  run_window_start?: string;
  run_window_end?: string;
  pot_ids?: string[];
}): Promise<void> {
  const existing = await getPreference<{
    enabled?: boolean;
    idle_only?: boolean;
    run_window_start?: string;
    run_window_end?: string;
    pot_ids?: string[];
  }>('idle.preferences') || {};

  const merged = {
    ...existing,
    ...patch,
  };

  await setPreference('idle.preferences', merged);
}

/**
 * Get system logging preferences
 */
export async function getLoggingPrefs(): Promise<LoggingPreferences> {
  const prefs = await getPreference<LoggingPreferences>('system.logging');
  return (
    prefs || {
      enabled: true,
      level: 'warn',
    }
  );
}

/**
 * Set system logging preferences
 */
export async function setLoggingPrefs(patch: Partial<LoggingPreferences>): Promise<void> {
  const existing = (await getPreference<LoggingPreferences>('system.logging')) || {
    enabled: true,
    level: 'warn',
  };

  const merged = {
    ...existing,
    ...patch,
  };

  await setPreference('system.logging', merged);
}
