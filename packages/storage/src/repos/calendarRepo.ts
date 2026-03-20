/**
 * Calendar Repository (029_calendar)
 *
 * CRUD and query functions for calendar_events, calendar_entry_dates,
 * calendar_notifications, and date-count aggregates used by the UI.
 *
 * Security: all audit events log metadata only (ids, counts, lengths).
 * No raw titles, body content, or excerpts are written to audit logs.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import { logAuditEvent } from './auditRepo.js';
import { toDateKey, getSystemTimezone } from '../utils/dateKey.js';
import type {
  CalendarEvent,
  CalendarEntryDate,
  CalendarNotification,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  UpsertCalendarEntryDateInput,
  CreateCalendarNotificationInput,
  CalendarRangeResult,
  CalendarDateResult,
  CalendarSearchResult,
} from '../types.js';

// ── Row mappers ─────────────────────────────────────────────────────────────

function toCalendarEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    pot_id: row.pot_id ?? null,
    title: row.title,
    details: row.details ?? null,
    start_at: row.start_at,
    end_at: row.end_at ?? null,
    all_day: row.all_day === 1,
    importance: row.importance,
    date_key: row.date_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toCalendarEntryDate(row: any): CalendarEntryDate {
  return {
    id: row.id,
    entry_id: row.entry_id,
    pot_id: row.pot_id,
    date_key: row.date_key,
    source_kind: row.source_kind,
    label: row.label ?? null,
    confidence: row.confidence ?? null,
    artifact_id: row.artifact_id ?? null,
    created_at: row.created_at,
  };
}

function toCalendarNotification(row: any): CalendarNotification {
  return {
    id: row.id,
    date_key: row.date_key,
    title: row.title,
    body: row.body,
    item_type: row.item_type,
    item_id: row.item_id,
    shown_at: row.shown_at ?? null,
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  };
}

// ── Calendar Events ──────────────────────────────────────────────────────────

export async function createCalendarEvent(
  input: CreateCalendarEventInput
): Promise<CalendarEvent> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();
  const tz = input.timezone ?? getSystemTimezone();
  const date_key = toDateKey(input.start_at, tz);

  await db.insertInto('calendar_events').values({
    id,
    pot_id: input.pot_id ?? null,
    title: input.title,
    details: input.details ?? null,
    start_at: input.start_at,
    end_at: input.end_at ?? null,
    all_day: input.all_day ? 1 : 0,
    importance: input.importance ?? 1,
    date_key,
    created_at: now,
    updated_at: now,
  }).execute();

  await logAuditEvent({
    actor: 'user',
    action: 'calendar_event_created',
    pot_id: input.pot_id,
    metadata: {
      event_id: id,
      date_key,
      all_day: input.all_day ?? false,
      importance: input.importance ?? 1,
    },
  });

  const row = await db.selectFrom('calendar_events').selectAll().where('id', '=', id).executeTakeFirst();
  return toCalendarEvent(row);
}

export async function getCalendarEvent(id: string): Promise<CalendarEvent | null> {
  const db = getDatabase();
  const row = await db.selectFrom('calendar_events').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toCalendarEvent(row) : null;
}

export async function updateCalendarEvent(
  id: string,
  input: UpdateCalendarEventInput,
  timezone?: string
): Promise<CalendarEvent | null> {
  const db = getDatabase();
  const now = Date.now();
  const existing = await getCalendarEvent(id);
  if (!existing) return null;

  const tz = timezone ?? getSystemTimezone();
  const newStartAt = input.start_at ?? existing.start_at;
  const date_key = input.start_at !== undefined ? toDateKey(newStartAt, tz) : existing.date_key;

  const updates: Record<string, unknown> = { updated_at: now };
  if (input.title !== undefined) updates.title = input.title;
  if (input.details !== undefined) updates.details = input.details;
  if (input.start_at !== undefined) { updates.start_at = input.start_at; updates.date_key = date_key; }
  if (input.end_at !== undefined) updates.end_at = input.end_at;
  if (input.all_day !== undefined) updates.all_day = input.all_day ? 1 : 0;
  if (input.importance !== undefined) updates.importance = input.importance;

  await db.updateTable('calendar_events').set(updates as any).where('id', '=', id).execute();

  await logAuditEvent({
    actor: 'user',
    action: 'calendar_event_updated',
    pot_id: existing.pot_id ?? undefined,
    metadata: { event_id: id, date_key },
  });

  return getCalendarEvent(id);
}

export async function deleteCalendarEvent(id: string): Promise<boolean> {
  const db = getDatabase();
  const existing = await getCalendarEvent(id);
  if (!existing) return false;

  await db.deleteFrom('calendar_events').where('id', '=', id).execute();

  await logAuditEvent({
    actor: 'user',
    action: 'calendar_event_deleted',
    pot_id: existing.pot_id ?? undefined,
    metadata: { event_id: id },
  });

  return true;
}

export async function listCalendarEventsInRange(
  from: string,
  to: string,
  potId?: string
): Promise<CalendarEvent[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('calendar_events')
    .selectAll()
    .where('date_key', '>=', from)
    .where('date_key', '<=', to)
    .orderBy('start_at', 'asc');

  if (potId) {
    query = query.where('pot_id', '=', potId);
  }

  const rows = await query.execute();
  return rows.map(toCalendarEvent);
}

// ── Calendar Entry Dates ─────────────────────────────────────────────────────

export async function upsertCalendarEntryDate(
  input: UpsertCalendarEntryDateInput
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('calendar_entry_dates')
    .values({
      id,
      entry_id: input.entry_id,
      pot_id: input.pot_id,
      date_key: input.date_key,
      source_kind: input.source_kind,
      label: input.label ?? null,
      confidence: input.confidence ?? null,
      artifact_id: input.artifact_id ?? null,
      created_at: now,
    })
    .onConflict((oc) =>
      oc
        .columns(['entry_id', 'date_key', 'source_kind'])
        .doUpdateSet({
          label: input.label ?? null,
          confidence: input.confidence ?? null,
          artifact_id: input.artifact_id ?? null,
        })
    )
    .execute();
}

export async function listEntryDatesInRange(
  from: string,
  to: string,
  potId?: string
): Promise<CalendarEntryDate[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('calendar_entry_dates')
    .selectAll()
    .where('date_key', '>=', from)
    .where('date_key', '<=', to)
    .orderBy('date_key', 'asc');

  if (potId) {
    query = query.where('pot_id', '=', potId);
  }

  const rows = await query.execute();
  return rows.map(toCalendarEntryDate);
}

export async function listEntryDatesForDate(
  dateKey: string,
  potId?: string
): Promise<CalendarEntryDate[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('calendar_entry_dates')
    .selectAll()
    .where('date_key', '=', dateKey)
    .orderBy('confidence', 'desc');

  if (potId) {
    query = query.where('pot_id', '=', potId);
  }

  const rows = await query.execute();
  return rows.map(toCalendarEntryDate);
}

// ── Date Count Aggregates ────────────────────────────────────────────────────

export async function getDateCounts(
  from: string,
  to: string,
  potId?: string
): Promise<{ entry_date_counts: Record<string, number>; history_counts: Record<string, number> }> {
  const db = getDatabase();

  // Entry date counts
  let edQuery = db
    .selectFrom('calendar_entry_dates')
    .select(['date_key', db.fn.count<number>('id').as('cnt')])
    .where('date_key', '>=', from)
    .where('date_key', '<=', to)
    .groupBy('date_key');

  if (potId) {
    edQuery = edQuery.where('pot_id', '=', potId);
  }

  const edRows = await edQuery.execute();
  const entry_date_counts: Record<string, number> = {};
  for (const r of edRows) {
    entry_date_counts[r.date_key] = Number(r.cnt);
  }

  // History counts
  const histRows = await db
    .selectFrom('browser_history')
    .select(['date_key', db.fn.count<number>('id').as('cnt')])
    .where('date_key', 'is not', null)
    .where('date_key', '>=', from)
    .where('date_key', '<=', to)
    .groupBy('date_key')
    .execute();

  const history_counts: Record<string, number> = {};
  for (const r of histRows) {
    if (r.date_key) history_counts[r.date_key] = Number(r.cnt);
  }

  return { entry_date_counts, history_counts };
}

export async function getCalendarRange(
  from: string,
  to: string,
  potId?: string
): Promise<CalendarRangeResult> {
  const [events, counts] = await Promise.all([
    listCalendarEventsInRange(from, to, potId),
    getDateCounts(from, to, potId),
  ]);

  return {
    events,
    entry_date_counts: counts.entry_date_counts,
    history_counts: counts.history_counts,
  };
}

export async function getCalendarDate(
  dateKey: string,
  potId?: string
): Promise<CalendarDateResult> {
  const db = getDatabase();

  const [events, entry_dates] = await Promise.all([
    listCalendarEventsInRange(dateKey, dateKey, potId),
    listEntryDatesForDate(dateKey, potId),
  ]);

  const histRows = await db
    .selectFrom('browser_history')
    .select(['id', 'url', 'title', 'visit_time'])
    .where('date_key', '=', dateKey)
    .orderBy('visit_time', 'desc')
    .limit(50)
    .execute();

  const history = histRows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title ?? null,
    visit_time: r.visit_time,
  }));

  return { events, entry_dates, history };
}

// ── Calendar Notifications ───────────────────────────────────────────────────

export async function getCalendarNotificationForDate(
  dateKey: string
): Promise<CalendarNotification | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('calendar_notifications')
    .selectAll()
    .where('date_key', '=', dateKey)
    .executeTakeFirst();
  return row ? toCalendarNotification(row) : null;
}

export async function insertCalendarNotification(
  input: CreateCalendarNotificationInput
): Promise<CalendarNotification> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db.insertInto('calendar_notifications').values({
    id,
    date_key: input.date_key,
    title: input.title,
    body: input.body,
    item_type: input.item_type,
    item_id: input.item_id,
    shown_at: null,
    read_at: null,
    created_at: now,
  }).execute();

  await logAuditEvent({
    actor: 'system',
    action: 'calendar_notification_created',
    metadata: {
      notification_id: id,
      date_key: input.date_key,
      item_type: input.item_type,
      item_id: input.item_id,
    },
  });

  const row = await db
    .selectFrom('calendar_notifications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return toCalendarNotification(row);
}

export async function markCalendarNotificationShown(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('calendar_notifications')
    .set({ shown_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

export async function markCalendarNotificationRead(id: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('calendar_notifications')
    .set({ read_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

export async function listUnreadCalendarNotifications(): Promise<CalendarNotification[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('calendar_notifications')
    .selectAll()
    .where('read_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map(toCalendarNotification);
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchCalendar(params: {
  q: string;
  from?: string;
  to?: string;
  pot_id?: string;
  limit?: number;
}): Promise<CalendarSearchResult> {
  const db = getDatabase();
  const limit = params.limit ?? 50;
  const q = `%${params.q}%`;

  // Search events by title/details
  let evQuery = db
    .selectFrom('calendar_events')
    .selectAll()
    .where((eb) => eb.or([
      eb('title', 'like', q),
      eb('details', 'like', q),
    ]))
    .orderBy('start_at', 'desc')
    .limit(limit);

  if (params.from) evQuery = evQuery.where('date_key', '>=', params.from);
  if (params.to) evQuery = evQuery.where('date_key', '<=', params.to);
  if (params.pot_id) evQuery = evQuery.where('pot_id', '=', params.pot_id);

  // Search entry dates by label
  let edQuery = db
    .selectFrom('calendar_entry_dates')
    .selectAll()
    .where('label', 'like', q)
    .orderBy('date_key', 'desc')
    .limit(limit);

  if (params.from) edQuery = edQuery.where('date_key', '>=', params.from);
  if (params.to) edQuery = edQuery.where('date_key', '<=', params.to);
  if (params.pot_id) edQuery = edQuery.where('pot_id', '=', params.pot_id);

  const [eventRows, entryDateRows] = await Promise.all([evQuery.execute(), edQuery.execute()]);

  return {
    events: eventRows.map(toCalendarEvent),
    entry_dates: entryDateRows.map(toCalendarEntryDate),
  };
}
