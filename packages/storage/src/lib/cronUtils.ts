/**
 * cronUtils — Cron-like expression helpers.
 * Extracted from scheduledTasksRepo for reuse + testability.
 */

/**
 * Compute next run timestamp from a cron-like expression + timezone.
 * Supported formats:
 *  - "daily at HH:MM"
 *  - "weekly on MON at HH:MM"
 *  - "@interval Xh/Xm/Xs"
 *  - "@once" (null — run once, no re-schedule)
 */
export function computeTaskNextRunAt(
  cronLike: string | null | undefined,
  timezone: string,
  fromMs: number,
): number | null {
  if (!cronLike || cronLike === '@once') return null;

  // @interval Xh/Xm/Xs
  const intervalMatch = cronLike.match(/^@interval\s+(\d+(?:\.\d+)?)(h|m|s)$/i);
  if (intervalMatch) {
    const value = parseFloat(intervalMatch[1] ?? '1');
    const unit = (intervalMatch[2] ?? 'h').toLowerCase();
    const ms = unit === 'h' ? value * 3600000 : unit === 'm' ? value * 60000 : value * 1000;
    return fromMs + ms;
  }

  // daily at HH:MM
  const dailyMatch = cronLike.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    return nextDailyAt(Number(dailyMatch[1] ?? '9'), Number(dailyMatch[2] ?? '0'), timezone, fromMs);
  }

  // weekly on DAY at HH:MM
  const weeklyMatch = cronLike.match(/^weekly\s+on\s+(\w+)\s+at\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    return nextWeeklyAt(
      weeklyMatch[1] ?? 'mon',
      Number(weeklyMatch[2] ?? '9'),
      Number(weeklyMatch[3] ?? '0'),
      timezone,
      fromMs,
    );
  }

  return null;
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function nextDailyAt(targetHour: number, targetMin: number, tz: string, fromMs: number): number {
  const from = new Date(fromMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(from);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 1) - 1;
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 1);

  const tzOffset = from.getTime() - new Date(from.toLocaleString('en-US', { timeZone: tz })).getTime();
  const targetMs = Date.UTC(year, month, day) + targetHour * 3600000 + targetMin * 60000 - tzOffset;

  if (targetMs > fromMs) return targetMs;
  return targetMs + 24 * 3600000;
}

function nextWeeklyAt(dayName: string, targetHour: number, targetMin: number, tz: string, fromMs: number): number {
  const targetDay = DAY_NAMES[dayName.toLowerCase().slice(0, 3)] ?? 1;
  const from = new Date(fromMs);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(from);

  const weekday = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) ?? 'mon';
  const curDay = DAY_NAMES[weekday] ?? 0;

  let daysAhead = targetDay - curDay;
  if (daysAhead < 0) daysAhead += 7;

  if (daysAhead === 0) {
    // Check time component
    const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
    const month = Number(parts.find((p) => p.type === 'month')?.value ?? 1) - 1;
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? 1);
    const tzOffset = from.getTime() - new Date(from.toLocaleString('en-US', { timeZone: tz })).getTime();
    const candidateMs = Date.UTC(year, month, day) + targetHour * 3600000 + targetMin * 60000 - tzOffset;
    if (candidateMs > fromMs) return candidateMs;
    daysAhead = 7;
  }

  return nextDailyAt(targetHour, targetMin, tz, fromMs + daysAhead * 24 * 3600000);
}

/**
 * Convert a cron-like expression to a human-readable description.
 * - "daily at 09:00"         → "Daily at 9:00 AM"
 * - "weekly on MON at 08:00" → "Weekly on Monday at 8:00 AM"
 * - "@interval 2h"           → "Every 2 hours"
 * - "@once"                  → "One time"
 * - null / unknown           → "Manual" / passthrough
 */
export function parseCronLikeDescription(cronLike: string | null | undefined): string {
  if (!cronLike) return 'Manual';
  if (cronLike === '@once') return 'One time';

  const intervalMatch = cronLike.match(/^@interval\s+(\d+(?:\.\d+)?)(h|m|s)$/i);
  if (intervalMatch) {
    const value = parseFloat(intervalMatch[1] ?? '1');
    const unit = (intervalMatch[2] ?? 'h').toLowerCase();
    if (unit === 'h') return `Every ${value} ${value === 1 ? 'hour' : 'hours'}`;
    if (unit === 'm') return `Every ${value} ${value === 1 ? 'minute' : 'minutes'}`;
    return `Every ${value} ${value === 1 ? 'second' : 'seconds'}`;
  }

  const dailyMatch = cronLike.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/i);
  if (dailyMatch) {
    const h = Number(dailyMatch[1] ?? '0');
    const m = Number(dailyMatch[2] ?? '0');
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    const displayM = `:${m.toString().padStart(2, '0')}`;
    return `Daily at ${displayH}${displayM} ${period}`;
  }

  const weeklyMatch = cronLike.match(/^weekly\s+on\s+(\w+)\s+at\s+(\d{1,2}):(\d{2})$/i);
  if (weeklyMatch) {
    const dayAbbr = (weeklyMatch[1] ?? 'mon').toLowerCase().slice(0, 3);
    const DAY_FULL: Record<string, string> = {
      sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
      thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
    };
    const fullDay = DAY_FULL[dayAbbr] ?? (weeklyMatch[1] ?? dayAbbr);
    const h = Number(weeklyMatch[2] ?? '0');
    const m = Number(weeklyMatch[3] ?? '0');
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    const displayM = `:${m.toString().padStart(2, '0')}`;
    return `Weekly on ${fullDay} at ${displayH}${displayM} ${period}`;
  }

  return cronLike; // passthrough for unknown format
}
