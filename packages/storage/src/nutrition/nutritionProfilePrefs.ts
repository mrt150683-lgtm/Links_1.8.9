/**
 * Nutrition Profile Preferences
 *
 * Stores user's dietary profile in user_prefs under key 'nutrition.profile'.
 * This profile is injected into AI prompts to personalize meal analysis,
 * daily reviews, weekly reviews, and recipe generation.
 */

import { getPreference, setPreference } from '../repos/prefsRepo.js';

const NUTRITION_PROFILE_KEY = 'nutrition.profile';

export interface NutritionProfile {
  weight?: number;
  weight_unit?: 'kg' | 'lbs';
  height?: number;
  height_unit?: 'cm' | 'ft_in';
  height_ft?: number;
  height_in?: number;
  body_fat_pct?: number;
  dietary_goals?: string[];
  likes?: string;      // max 10,000 chars
  dislikes?: string;   // max 10,000 chars
  allergies?: string[];
  health_context?: string;
  units?: 'metric' | 'imperial';
  timezone?: string;
  preferred_checkin_day?: 0 | 1 | 2 | 3 | 4 | 5 | 6;  // 0=Sun
  preferred_checkin_time?: string;  // HH:MM
  explanation_style?: 'simple' | 'practical' | 'technical' | 'expert';
}

export async function getNutritionProfile(): Promise<NutritionProfile> {
  return (await getPreference<NutritionProfile>(NUTRITION_PROFILE_KEY)) ?? {};
}

export async function setNutritionProfilePatch(
  patch: Partial<NutritionProfile>,
): Promise<NutritionProfile> {
  const existing = await getNutritionProfile();
  const updated: NutritionProfile = { ...existing, ...patch };
  await setPreference(NUTRITION_PROFILE_KEY, updated);
  return updated;
}

/**
 * Build a compact profile context string for AI prompts.
 */
export function buildProfileContext(profile: NutritionProfile): string {
  const parts: string[] = [];

  if (profile.dietary_goals?.length) {
    parts.push(`Dietary goals: ${profile.dietary_goals.join(', ')}`);
  }
  if (profile.allergies?.length) {
    parts.push(`ALLERGIES (hard constraint — flag any matches): ${profile.allergies.join(', ')}`);
  }
  if (profile.dislikes) {
    const preview = profile.dislikes.slice(0, 500);
    parts.push(`Dislikes: ${preview}`);
  }
  if (profile.likes) {
    const preview = profile.likes.slice(0, 500);
    parts.push(`Likes: ${preview}`);
  }
  if (profile.health_context) {
    parts.push(`Health context: ${profile.health_context}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'No profile set.';
}
