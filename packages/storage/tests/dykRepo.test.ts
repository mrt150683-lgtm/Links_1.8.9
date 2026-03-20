/**
 * DYK Repo Unit Tests (in-memory SQLite via temp file)
 *
 * Tests: computeDykSignature, computeDykNovelty,
 *        insertDykItems (dedup), getNextEligibleDyk,
 *        updateDykItemStatus (snooze), dyk_notifications CRUD
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase, runMigrations } from '../src/index.js';
import { createPot } from '../src/repos/potsRepo.js';
import { createTextEntryIdempotent } from '../src/repos/entriesRepo.js';
import {
  computeDykSignature,
  computeDykNovelty,
  insertDykItems,
  listDykItems,
  getDykItem,
  updateDykItemStatus,
  getNextEligibleDyk,
  insertDykFeedbackEvent,
  createDykNotification,
  listDykNotifications,
  updateDykNotificationStatus,
  getPotDykState,
  setPotDykState,
} from '../src/repos/dykRepo.js';
import type { DykItem } from '../src/types.js';

const TEST_DB = `./test-dyk-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('dykRepo', () => {
  let potId: string;
  let entryId: string;

  beforeEach(async () => {
    initDatabase({ filename: TEST_DB });
    runMigrations();
    const pot = await createPot({ name: 'Test Pot' });
    potId = pot.id;
    const entry = await createTextEntryIdempotent({
      pot_id: potId,
      content_text: 'This is a test entry about machine learning and neural networks.',
      capture_method: 'test',
    });
    entryId = entry.entry.id;
  });

  afterEach(() => {
    closeDatabase();
    try { unlinkSync(TEST_DB); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  });

  // ── computeDykSignature ───────────────────────────────────────────────

  describe('computeDykSignature', () => {
    it('is deterministic — same inputs produce the same hash', () => {
      const sig1 = computeDykSignature(
        'Did you know neural networks are powerful',
        'Neural networks can learn complex patterns.',
        ['neural', 'networks', 'learning'],
        'entry_summary',
        '1',
        'hash123',
      );
      const sig2 = computeDykSignature(
        'Did you know neural networks are powerful',
        'Neural networks can learn complex patterns.',
        ['neural', 'networks', 'learning'],
        'entry_summary',
        '1',
        'hash123',
      );
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // SHA-256 hex
    });

    it('produces different hashes for different content', () => {
      const sig1 = computeDykSignature('Title A', 'Body A', ['a'], 'entry_summary', '1', null);
      const sig2 = computeDykSignature('Title B', 'Body B', ['b'], 'entry_summary', '1', null);
      expect(sig1).not.toBe(sig2);
    });

    it('is case-insensitive and whitespace-normalized', () => {
      const sig1 = computeDykSignature('Did you know', 'body text', ['keyword'], 'entry_summary', '1', null);
      const sig2 = computeDykSignature('DID YOU KNOW', 'BODY TEXT', ['keyword'], 'entry_summary', '1', null);
      expect(sig1).toBe(sig2);
    });

    it('keyword order does not affect signature', () => {
      const sig1 = computeDykSignature('t', 'b', ['a', 'b', 'c'], 'entry_summary', '1', null);
      const sig2 = computeDykSignature('t', 'b', ['c', 'a', 'b'], 'entry_summary', '1', null);
      expect(sig1).toBe(sig2);
    });
  });

  // ── computeDykNovelty ─────────────────────────────────────────────────

  describe('computeDykNovelty', () => {
    it('returns 1 when no existing items', () => {
      const novelty = computeDykNovelty(['a', 'b'], []);
      expect(novelty).toBe(1);
    });

    it('returns ~0 for identical keywords', () => {
      const existing: DykItem[] = [
        { id: '1', pot_id: potId, entry_id: entryId, title: 't', body: 'b',
          keywords: ['neural', 'networks', 'learning'],
          confidence: 0.8, novelty: 1, source_type: 'entry_summary', status: 'shown',
          shown_count: 1, signature: 'x', model_id: 'm', prompt_id: 'p', prompt_version: '1',
          role_hash: null, evidence: null, next_eligible_at: 0,
          created_at: Date.now(), updated_at: Date.now() },
      ];
      const novelty = computeDykNovelty(['neural', 'networks', 'learning'], existing);
      expect(novelty).toBeCloseTo(0, 1);
    });

    it('returns ~1 for completely disjoint keywords', () => {
      const existing: DykItem[] = [
        { id: '1', pot_id: potId, entry_id: entryId, title: 't', body: 'b',
          keywords: ['apple', 'banana', 'cherry'],
          confidence: 0.8, novelty: 1, source_type: 'entry_summary', status: 'shown',
          shown_count: 1, signature: 'x', model_id: 'm', prompt_id: 'p', prompt_version: '1',
          role_hash: null, evidence: null, next_eligible_at: 0,
          created_at: Date.now(), updated_at: Date.now() },
      ];
      const novelty = computeDykNovelty(['xyz', 'foo', 'bar'], existing);
      expect(novelty).toBeCloseTo(1, 1);
    });
  });

  // ── insertDykItems ────────────────────────────────────────────────────

  describe('insertDykItems', () => {
    it('inserts new items and returns them', async () => {
      const signature = computeDykSignature('Test title', 'Test body', ['kw1', 'kw2'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId,
        entry_id: entryId,
        title: 'Did you know test',
        body: 'Test body text.',
        keywords: ['kw1', 'kw2'],
        confidence: 0.85,
        novelty: 0.9,
        source_type: 'entry_summary',
        signature,
        model_id: 'test-model',
        prompt_id: 'dyk_generate_from_entry',
        prompt_version: '1',
      }]);

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Did you know test');
      expect(items[0].status).toBe('new');
      expect(items[0].keywords).toEqual(['kw1', 'kw2']);
    });

    it('skips items with duplicate signature for the same pot', async () => {
      const signature = computeDykSignature('Title', 'Body', ['kw'], 'entry_summary', '1', null);
      const input = [{
        pot_id: potId,
        entry_id: entryId,
        title: 'Did you know dup',
        body: 'Body text.',
        keywords: ['kw'],
        confidence: 0.7,
        novelty: 0.8,
        source_type: 'entry_summary' as const,
        signature,
        model_id: 'model',
        prompt_id: 'prompt',
        prompt_version: '1',
      }];

      const first = await insertDykItems(input);
      expect(first).toHaveLength(1);

      const second = await insertDykItems(input);
      expect(second).toHaveLength(0); // Skipped duplicate
    });
  });

  // ── getNextEligibleDyk ────────────────────────────────────────────────

  describe('getNextEligibleDyk', () => {
    it('returns highest novelty+confidence item with status new/queued', async () => {
      const s1 = computeDykSignature('t1', 'b1', ['a'], 'entry_summary', '1', null);
      const s2 = computeDykSignature('t2', 'b2', ['b'], 'entry_summary', '1', null);

      await insertDykItems([
        { pot_id: potId, entry_id: entryId, title: 'Low', body: 'b', keywords: ['a'],
          confidence: 0.5, novelty: 0.5, source_type: 'entry_summary', signature: s1,
          model_id: 'm', prompt_id: 'p', prompt_version: '1' },
        { pot_id: potId, entry_id: entryId, title: 'High', body: 'b', keywords: ['b'],
          confidence: 0.9, novelty: 0.9, source_type: 'entry_summary', signature: s2,
          model_id: 'm', prompt_id: 'p', prompt_version: '1' },
      ]);

      const next = await getNextEligibleDyk(potId);
      expect(next).not.toBeNull();
      expect(next!.title).toBe('High');
    });

    it('excludes items with status=known', async () => {
      const s = computeDykSignature('known', 'b', ['x'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId, entry_id: entryId, title: 'known item', body: 'b', keywords: ['x'],
        confidence: 0.9, novelty: 0.9, source_type: 'entry_summary', signature: s,
        model_id: 'm', prompt_id: 'p', prompt_version: '1',
      }]);

      await updateDykItemStatus(items[0].id, 'known');

      const next = await getNextEligibleDyk(potId);
      expect(next).toBeNull();
    });

    it('excludes snoozed items with future next_eligible_at', async () => {
      const s = computeDykSignature('snoozed', 'b', ['y'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId, entry_id: entryId, title: 'snoozed item', body: 'b', keywords: ['y'],
        confidence: 0.9, novelty: 0.9, source_type: 'entry_summary', signature: s,
        model_id: 'm', prompt_id: 'p', prompt_version: '1',
      }]);

      const futureTime = Date.now() + 24 * 3_600_000;
      await updateDykItemStatus(items[0].id, 'snoozed', futureTime);

      const next = await getNextEligibleDyk(potId);
      expect(next).toBeNull();
    });
  });

  // ── updateDykItemStatus (snooze) ──────────────────────────────────────

  describe('updateDykItemStatus', () => {
    it('sets next_eligible_at correctly for snooze', async () => {
      const s = computeDykSignature('snooze-test', 'b', ['z'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId, entry_id: entryId, title: 'snooze test', body: 'b', keywords: ['z'],
        confidence: 0.8, novelty: 0.8, source_type: 'entry_summary', signature: s,
        model_id: 'm', prompt_id: 'p', prompt_version: '1',
      }]);

      const snoozeUntil = Date.now() + 24 * 3_600_000;
      await updateDykItemStatus(items[0].id, 'snoozed', snoozeUntil);

      const updated = await getDykItem(items[0].id);
      expect(updated!.status).toBe('snoozed');
      expect(updated!.next_eligible_at).toBeCloseTo(snoozeUntil, -2);
    });
  });

  // ── dyk_notifications ────────────────────────────────────────────────

  describe('dyk_notifications', () => {
    it('creates and lists unread notifications', async () => {
      const s = computeDykSignature('notif', 'b', ['n'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId, entry_id: entryId, title: 'Did you know notif', body: 'Body.',
        keywords: ['n'], confidence: 0.8, novelty: 0.8, source_type: 'entry_summary', signature: s,
        model_id: 'm', prompt_id: 'p', prompt_version: '1',
      }]);

      await createDykNotification({
        pot_id: potId,
        dyk_id: items[0].id,
        title: items[0].title,
        body: items[0].body,
      });

      const notifs = await listDykNotifications(potId, { unread_only: true });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].status).toBe('unread');
    });

    it('marks notification as read', async () => {
      const s = computeDykSignature('mark-read', 'b', ['r'], 'entry_summary', '1', null);
      const items = await insertDykItems([{
        pot_id: potId, entry_id: entryId, title: 'Did you know read', body: 'Body.',
        keywords: ['r'], confidence: 0.8, novelty: 0.8, source_type: 'entry_summary', signature: s,
        model_id: 'm', prompt_id: 'p', prompt_version: '1',
      }]);

      const notif = await createDykNotification({
        pot_id: potId, dyk_id: items[0].id, title: 'title', body: 'body',
      });

      await updateDykNotificationStatus(notif.id, 'read');
      const unread = await listDykNotifications(potId, { unread_only: true });
      expect(unread).toHaveLength(0);
    });
  });

  // ── Pot DYK State ────────────────────────────────────────────────────

  describe('getPotDykState / setPotDykState', () => {
    it('returns default state when nothing is set', async () => {
      const state = await getPotDykState(potId);
      expect(state.interval_hours).toBe(4);
      expect(state.next_dyk_due_at).toBe(0);
    });

    it('saves and retrieves state', async () => {
      const future = Date.now() + 4 * 3_600_000;
      await setPotDykState(potId, { next_dyk_due_at: future, interval_hours: 6 });

      const state = await getPotDykState(potId);
      expect(state.interval_hours).toBe(6);
      expect(state.next_dyk_due_at).toBeCloseTo(future, -2);
    });
  });
});
