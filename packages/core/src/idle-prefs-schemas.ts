import { z } from 'zod';

/**
 * Idle Processing Preferences Schema
 * Phase 5: User preferences for idle-time AI processing
 */

export const IdleProcessingPreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  idle_only: z.boolean().optional(),
  run_window_start: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:MM format
  run_window_end: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:MM format
  pot_ids: z.array(z.string()).optional(), // Specific pots to process, null/undefined = all pots
});

export type IdleProcessingPreferences = z.infer<typeof IdleProcessingPreferencesSchema>;

/**
 * Response format for GET /prefs/idle
 */
export interface IdleProcessingPrefsResponse extends IdleProcessingPreferences {
  enabled: boolean;
  idle_only: boolean;
  run_window_start?: string;
  run_window_end?: string;
  pot_ids?: string[]; // If undefined/null, process all pots
}
