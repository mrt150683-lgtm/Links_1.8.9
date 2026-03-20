/**
 * Journal Module: Shared utilities for journal job handlers
 */

import { createHash } from 'node:crypto';
import { getDatabase } from '@links/storage';
import type { DerivedArtifact, Entry } from '@links/storage';

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Build a stable SHA-256 fingerprint from a sorted list of entry+content_sha256 pairs.
 * Two runs with identical entries produce the same fingerprint → idempotency skip.
 */
export function buildInputFingerprint(
  entries: Array<{ id: string; content_sha256: string | null }>,
): string {
  const pairs = entries
    .map((e) => `${e.id}:${e.content_sha256 ?? ''}`)
    .sort()
    .join('\n');

  return createHash('sha256').update(pairs).digest('hex');
}

/**
 * Build a fingerprint from child journal entries (for rollups).
 */
export function buildRollupFingerprint(
  children: Array<{ id: string; created_at: number }>,
): string {
  const pairs = children
    .map((c) => `${c.id}:${c.created_at}`)
    .sort()
    .join('\n');

  return createHash('sha256').update(pairs).digest('hex');
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough estimate: 4 chars ≈ 1 token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Entry formatting for prompt
// ---------------------------------------------------------------------------

/**
 * Format one entry and its artifacts into a prompt block.
 * Respects per-entry char budget.
 */
export function formatEntryBlock(
  entry: Entry,
  artifacts: DerivedArtifact[],
  maxCharsPerEntry: number,
): string {
  const lines: string[] = [];

  lines.push(`<entry id="${entry.id}" type="${entry.type}" captured_at="${new Date(entry.captured_at).toISOString()}">`);

  if (entry.source_url) {
    lines.push(`  <url>${entry.source_url}</url>`);
  }
  if (entry.source_title || entry.link_title) {
    lines.push(`  <title>${entry.source_title ?? entry.link_title ?? ''}</title>`);
  }

  if (entry.content_text) {
    const truncated = entry.content_text.slice(0, maxCharsPerEntry);
    const wasTruncated = entry.content_text.length > maxCharsPerEntry;
    lines.push(`  <content${wasTruncated ? ' truncated="true"' : ''}>${truncated}</content>`);
  }

  for (const artifact of artifacts) {
    const payloadStr = JSON.stringify(artifact.payload);
    const truncated = payloadStr.slice(0, 2000);
    lines.push(`  <artifact type="${artifact.artifact_type}" prompt_version="${artifact.prompt_version}">${truncated}</artifact>`);
  }

  lines.push('</entry>');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Job payload reader
// ---------------------------------------------------------------------------

/**
 * Read and parse the payload_json from a processing_jobs row.
 */
export async function getJobPayload<T = unknown>(jobId: string): Promise<T | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('processing_jobs')
    .select('payload_json')
    .where('id', '=', jobId)
    .executeTakeFirst();

  if (!row || !row.payload_json) {
    return null;
  }

  return JSON.parse(row.payload_json) as T;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Parse a YYYY-MM-DD string into a Date at UTC midnight.
 */
export function parseYmd(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

/**
 * Format a Date to YYYY-MM-DD (UTC).
 */
export function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Compute the 7-day window ending on endDateYmd (inclusive).
 * Returns { period_start_ymd, period_end_ymd }.
 */
export function computeWeekRange(endDateYmd: string): { period_start_ymd: string; period_end_ymd: string } {
  const endDate = parseYmd(endDateYmd);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  return {
    period_start_ymd: formatYmd(startDate),
    period_end_ymd: endDateYmd,
  };
}

/**
 * Get today's date in YYYY-MM-DD format (UTC).
 */
export function todayYmd(): string {
  return formatYmd(new Date());
}

/**
 * Get yesterday's date in YYYY-MM-DD format (UTC).
 */
export function yesterdayYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return formatYmd(d);
}

/**
 * Compute the UTC epoch window [startMs, endMs) for a local-day date.
 * Since we treat all dates as UTC for now (timezone=UTC), this is straightforward.
 * Future: use a timezone library (e.g., @js-temporal/polyfill) for non-UTC scopes.
 */
export function computeDayWindow(dateYmd: string): { startMs: number; endMs: number } {
  const start = parseYmd(dateYmd);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * Get ISO calendar month boundaries for YYYY-MM.
 */
export function computeMonthRange(yearMonth: string): { period_start_ymd: string; period_end_ymd: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = new Date(Date.UTC(year!, month! - 1, 1));
  const endDate = new Date(Date.UTC(year!, month!, 0)); // last day of month

  return {
    period_start_ymd: formatYmd(startDate),
    period_end_ymd: formatYmd(endDate),
  };
}

/**
 * Get quarter boundaries for a year + quarter number (1-4).
 */
export function computeQuarterRange(year: number, quarter: number): { period_start_ymd: string; period_end_ymd: string } {
  const startMonth = (quarter - 1) * 3; // 0-indexed
  const startDate = new Date(Date.UTC(year, startMonth, 1));
  const endDate = new Date(Date.UTC(year, startMonth + 3, 0)); // last day of quarter

  return {
    period_start_ymd: formatYmd(startDate),
    period_end_ymd: formatYmd(endDate),
  };
}

/**
 * Get year boundaries for a given year.
 */
export function computeYearRange(year: number): { period_start_ymd: string; period_end_ymd: string } {
  return {
    period_start_ymd: `${year}-01-01`,
    period_end_ymd: `${year}-12-31`,
  };
}
