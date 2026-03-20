/**
 * Calendar Repo Unit Tests (in-memory SQLite via temp file)
 *
 * Tests: createCalendarEvent, upsertCalendarEntryDate (idempotency),
 *        insertCalendarNotification (unique date_key), getDateCounts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase, runMigrations } from '../src/index.js';
import { createPot } from '../src/repos/potsRepo.js';
import { createTextEntryIdempotent } from '../src/repos/entriesRepo.js';
import {
  createCalendarEvent,
  getCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  upsertCalendarEntryDate,
  getDateCounts,
  insertCalendarNotification,
  getCalendarNotificationForDate,
  getCalendarRange,
  getCalendarDate,
  searchCalendar,
} from '../src/repos/calendarRepo.js';

const TEST_DB = `./test-calendar-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('calendarRepo', () => {
  let potId: string;

  beforeEach(async () => {
    initDatabase({ filename: TEST_DB });
    runMigrations();
    const pot = await createPot({ name: 'Test Pot' });
    potId = pot.id;
  });

  afterEach(() => {
    closeDatabase();
    try { unlinkSync(TEST_DB); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  });

  // ── createCalendarEvent / CRUD ─────────────────────────────────────

  describe('createCalendarEvent', () => {
    it('creates an event and computes date_key', async () => {
      const start_at = Date.UTC(2026, 2, 10, 14, 0, 0); // 2026-03-10T14:00Z
      const event = await createCalendarEvent({
        title: 'Team sync',
        start_at,
        all_day: false,
        importance: 50,
        timezone: 'UTC',
      });

      expect(event.id).toBeDefined();
      expect(event.title).toBe('Team sync');
      expect(event.date_key).toBe('2026-03-10');
      expect(event.start_at).toBe(start_at);
      expect(event.all_day).toBe(false);
      expect(event.importance).toBe(50);
    });

    it('creates an all-day event with pot_id', async () => {
      const event = await createCalendarEvent({
        title: 'All-day event',
        start_at: Date.UTC(2026, 2, 15, 0, 0, 0),
        all_day: true,
        importance: 1,
        pot_id: potId,
        timezone: 'UTC',
      });

      expect(event.all_day).toBe(true);
      expect(event.pot_id).toBe(potId);
    });
  });

  describe('getCalendarEvent', () => {
    it('returns null for unknown id', async () => {
      const result = await getCalendarEvent('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('returns event by id', async () => {
      const created = await createCalendarEvent({
        title: 'Fetch test',
        start_at: Date.UTC(2026, 2, 10, 9, 0, 0),
        all_day: false,
        importance: 1,
        timezone: 'UTC',
      });

      const found = await getCalendarEvent(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Fetch test');
    });
  });

  describe('updateCalendarEvent', () => {
    it('updates title and importance', async () => {
      const event = await createCalendarEvent({
        title: 'Old title',
        start_at: Date.UTC(2026, 2, 10, 9, 0, 0),
        all_day: false,
        importance: 1,
        timezone: 'UTC',
      });

      const updated = await updateCalendarEvent(event.id, { title: 'New title', importance: 100 }, 'UTC');
      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('New title');
      expect(updated!.importance).toBe(100);
    });
  });

  describe('deleteCalendarEvent', () => {
    it('returns true after deletion, false for unknown id', async () => {
      const event = await createCalendarEvent({
        title: 'To delete',
        start_at: Date.UTC(2026, 2, 10, 9, 0, 0),
        all_day: false,
        importance: 1,
        timezone: 'UTC',
      });

      expect(await deleteCalendarEvent(event.id)).toBe(true);
      expect(await getCalendarEvent(event.id)).toBeNull();
      expect(await deleteCalendarEvent(event.id)).toBe(false);
    });
  });

  // ── upsertCalendarEntryDate — idempotency ──────────────────────────

  describe('upsertCalendarEntryDate', () => {
    it('inserts a new entry_date row', async () => {
      const result = await createTextEntryIdempotent({
        pot_id: potId,
        title: 'Entry 1',
        content_text: 'test',
        idempotency_key: 'idem-1',
        source_url: null,
        metadata: {},
        captured_at: Date.now(),
      });

      const entryId = result.entry.id;
      await upsertCalendarEntryDate({
        entry_id: entryId,
        pot_id: potId,
        date_key: '2026-03-10',
        source_kind: 'extracted_date',
        label: 'Test date',
        confidence: 0.9,
        artifact_id: null,
      });

      const detail = await getCalendarDate('2026-03-10', potId);
      expect(detail.entry_dates.some((ed) => ed.entry_id === entryId)).toBe(true);
    });

    it('upsert is idempotent on (entry_id, date_key, source_kind)', async () => {
      const result = await createTextEntryIdempotent({
        pot_id: potId,
        title: 'Entry 2',
        content_text: 'test',
        idempotency_key: 'idem-2',
        source_url: null,
        metadata: {},
        captured_at: Date.now(),
      });

      const entryId = result.entry.id;
      const input = {
        entry_id: entryId,
        pot_id: potId,
        date_key: '2026-03-11',
        source_kind: 'extracted_date' as const,
        label: 'First insert',
        confidence: 0.8,
        artifact_id: null,
      };

      await upsertCalendarEntryDate(input);
      await upsertCalendarEntryDate({ ...input, label: 'Second insert', confidence: 0.95 });

      // Should have only one row for this combination
      const detail = await getCalendarDate('2026-03-11', potId);
      const rows = detail.entry_dates.filter((ed) => ed.entry_id === entryId);
      expect(rows).toHaveLength(1);
    });
  });

  // ── getDateCounts — aggregation ────────────────────────────────────

  describe('getDateCounts', () => {
    it('aggregates entry_date counts by date_key', async () => {
      const result = await createTextEntryIdempotent({
        pot_id: potId,
        title: 'Count test entry',
        content_text: 'hello',
        idempotency_key: 'idem-count',
        source_url: null,
        metadata: {},
        captured_at: Date.now(),
      });
      const entryId = result.entry.id;

      await upsertCalendarEntryDate({
        entry_id: entryId,
        pot_id: potId,
        date_key: '2026-04-01',
        source_kind: 'extracted_date',
        label: null,
        confidence: null,
        artifact_id: null,
      });

      const counts = await getDateCounts('2026-04-01', '2026-04-01', potId);
      expect(counts.entry_date_counts['2026-04-01']).toBeGreaterThanOrEqual(1);
    });

    it('returns empty maps when no data', async () => {
      const counts = await getDateCounts('2020-01-01', '2020-01-31');
      expect(Object.keys(counts.entry_date_counts)).toHaveLength(0);
      expect(Object.keys(counts.history_counts)).toHaveLength(0);
    });
  });

  // ── insertCalendarNotification — uniqueness ────────────────────────

  describe('insertCalendarNotification', () => {
    it('inserts a notification for a date', async () => {
      await insertCalendarNotification({
        date_key: '2026-03-05',
        title: 'Test notification',
        body: 'You have an event',
        item_type: 'event',
        item_id: 'evt-1',
      });

      const notif = await getCalendarNotificationForDate('2026-03-05');
      expect(notif).not.toBeNull();
      expect(notif!.date_key).toBe('2026-03-05');
    });

    it('second insert for same date_key throws (UNIQUE constraint)', async () => {
      await insertCalendarNotification({
        date_key: '2026-03-06',
        title: 'First',
        body: 'Body 1',
        item_type: 'event',
        item_id: 'evt-2',
      });

      await expect(
        insertCalendarNotification({
          date_key: '2026-03-06',
          title: 'Duplicate',
          body: 'Body 2',
          item_type: 'event',
          item_id: 'evt-3',
        })
      ).rejects.toThrow();
    });
  });

  // ── getCalendarRange ───────────────────────────────────────────────

  describe('getCalendarRange', () => {
    it('returns event_date_counts and events for range', async () => {
      const start_at = Date.UTC(2026, 5, 10, 10, 0, 0);
      await createCalendarEvent({
        title: 'Range test event',
        start_at,
        all_day: false,
        importance: 1,
        timezone: 'UTC',
      });

      const result = await getCalendarRange('2026-06-01', '2026-06-30');
      expect(result.events.some((e) => e.title === 'Range test event')).toBe(true);
    });

    it('excludes events outside the range', async () => {
      const start_at = Date.UTC(2026, 0, 1, 10, 0, 0); // Jan 2026
      await createCalendarEvent({
        title: 'Out of range',
        start_at,
        all_day: false,
        importance: 1,
        timezone: 'UTC',
      });

      const result = await getCalendarRange('2026-06-01', '2026-06-30');
      expect(result.events.some((e) => e.title === 'Out of range')).toBe(false);
    });
  });

  // ── searchCalendar ─────────────────────────────────────────────────

  describe('searchCalendar', () => {
    it('finds events by title keyword', async () => {
      await createCalendarEvent({
        title: 'Annual performance review',
        start_at: Date.UTC(2026, 2, 20, 10, 0, 0),
        all_day: false,
        importance: 50,
        timezone: 'UTC',
      });

      const result = await searchCalendar({ q: 'performance', limit: 10 });
      expect(result.events.some((e) => e.title.includes('performance'))).toBe(true);
    });

    it('returns empty arrays when no match', async () => {
      const result = await searchCalendar({ q: 'zzznomatchzz', limit: 10 });
      expect(result.events).toHaveLength(0);
      expect(result.entry_dates).toHaveLength(0);
    });
  });
});
