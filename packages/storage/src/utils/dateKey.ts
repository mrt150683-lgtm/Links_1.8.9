/**
 * Timezone-aware date key utilities
 * Returns YYYY-MM-DD strings in the configured timezone.
 */

/**
 * Convert epoch milliseconds to a YYYY-MM-DD date key in the given IANA timezone.
 * Uses Intl.DateTimeFormat with locale 'en-CA' which formats as YYYY-MM-DD natively.
 */
export function toDateKey(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(epochMs));
}

/**
 * Get the system's local timezone string (IANA format).
 */
export function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get today's date key (YYYY-MM-DD) in the given timezone.
 */
export function todayDateKey(timezone: string): string {
  return toDateKey(Date.now(), timezone);
}
