/**
 * Diet Pot Provisioning
 *
 * Ensures a single "Diet" pot exists for the nutrition module.
 * The pot ID is stored in user_prefs under key 'nutrition.diet_pot_id'.
 *
 * Idempotent: calling ensureDietPotExists() multiple times is safe.
 */

import { getPreference, setPreference } from '../repos/prefsRepo.js';
import { createPot, getPotById } from '../repos/potsRepo.js';

const DIET_POT_PREF_KEY = 'nutrition.diet_pot_id';

export async function getDietPotId(): Promise<string | null> {
  return getPreference<string>(DIET_POT_PREF_KEY);
}

/**
 * Ensure the diet pot exists. Creates it if missing or if the stored ID is stale.
 * Returns the canonical pot_id.
 */
export async function ensureDietPotExists(): Promise<string> {
  const existingId = await getDietPotId();

  if (existingId) {
    const pot = await getPotById(existingId);
    if (pot) {
      return existingId;
    }
    // Stored ID is stale (pot was deleted) — fall through to create
  }

  const pot = await createPot({
    name: 'Diet',
    description: 'Meal tracking and nutrition analysis',
  });

  await setPreference(DIET_POT_PREF_KEY, pot.id);
  return pot.id;
}
