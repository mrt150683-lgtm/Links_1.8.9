/**
 * Idle-time policy controls
 * Phase 5: Baseline implementation
 */

import type { Config } from '@links/config';
import { getForceRunUntil, clearForceRunNow } from '@links/storage';

export interface IdlePolicyConfig {
  enabled: boolean; // IDLE_MODE_ENABLED
  idleOnly: boolean; // IDLE_ONLY (if true, only run when system idle)
  runWindowStart?: string; // RUN_WINDOW_START (HH:MM local time)
  runWindowEnd?: string; // RUN_WINDOW_END (HH:MM local time)
}

export interface IdlePolicyState {
  forceRunUntil: number | null; // Epoch ms, set by "run now" override
}

/**
 * Load idle policy configuration from env
 */
export function loadIdlePolicyConfig(config: Config): IdlePolicyConfig {
  return {
    enabled: process.env.IDLE_MODE_ENABLED === 'true',
    idleOnly: process.env.IDLE_ONLY === 'true',
    runWindowStart: process.env.RUN_WINDOW_START,
    runWindowEnd: process.env.RUN_WINDOW_END,
  };
}

/**
 * Check if worker should process jobs now
 *
 * @param policyConfig - Idle policy configuration
 * @param now - Current timestamp (epoch ms)
 * @returns true if allowed to process jobs
 */
export async function isProcessingAllowed(
  policyConfig: IdlePolicyConfig,
  now: number,
): Promise<boolean> {
  // Disabled mode: always allow
  if (!policyConfig.enabled) {
    return true;
  }

  // Check "run now" override
  const forceRunUntil = await getForceRunUntil();
  if (forceRunUntil && now < forceRunUntil) {
    return true;
  }

  // Check time window (if configured)
  if (policyConfig.runWindowStart && policyConfig.runWindowEnd) {
    if (!isInTimeWindow(now, policyConfig.runWindowStart, policyConfig.runWindowEnd)) {
      return false;
    }
  }

  // Idle-only mode: Phase 5 baseline doesn't check system idle
  // (Future: integrate with OS idle detection)
  if (policyConfig.idleOnly) {
    // For Phase 5: treat as allowed (no idle detection yet)
    return true;
  }

  return true;
}

/**
 * Check if current time is within configured window
 *
 * @param now - Current timestamp (epoch ms)
 * @param startTime - Start time (HH:MM format, 24-hour)
 * @param endTime - End time (HH:MM format, 24-hour)
 * @returns true if within window
 */
function isInTimeWindow(now: number, startTime: string, endTime: string): boolean {
  const date = new Date(now);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  const startParts = startTime.split(':').map(Number);
  const endParts = endTime.split(':').map(Number);

  if (startParts.length !== 2 || endParts.length !== 2) {
    throw new Error('Invalid time format, expected HH:MM');
  }

  const [startHour, startMin] = startParts;
  const [endHour, endMin] = endParts;

  if (
    startHour === undefined ||
    startMin === undefined ||
    endHour === undefined ||
    endMin === undefined
  ) {
    throw new Error('Invalid time format, expected HH:MM');
  }

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight window (e.g., 22:00-06:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}
