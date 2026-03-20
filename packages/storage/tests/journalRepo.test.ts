/**
 * Journal Repo Unit Tests (in-memory SQLite via temp file)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase, runMigrations } from '../src/index.js';
import {
  upsertJournalEntry,
  getJournalEntry,
  getJournalEntryById,
  listJournalEntries,
  listChildJournalEntries,
  journalEntryExistsByFingerprint,
} from '../src/repos/journalRepo.js';
import { createPot } from '../src/repos/potsRepo.js';
import type { CreateJournalEntryInput } from '../src/types.js';

const TEST_DB = './test-journal-repo.db';

function makeInput(overrides: Partial<CreateJournalEntryInput> = {}): CreateJournalEntryInput {
  return {
    kind: 'daily',
    scope_type: 'global',
    scope_id: undefined,
    period_start_ymd: '2026-02-17',
    period_end_ymd: '2026-02-17',
    timezone: 'UTC',
    model_id: 'test/model-1',
    prompt_id: 'journal_daily_v1',
    prompt_version: '1',
    temperature: 0.2,
    max_tokens: 1800,
    input_fingerprint: 'fp-abc-123',
    content: { schema_version: 1, headline: 'Test day' },
    citations: [],
    ...overrides,
  };
}

describe('journalRepo', () => {
  beforeEach(() => {
    initDatabase({ filename: TEST_DB });
    runMigrations();
  });

  afterEach(() => {
    closeDatabase();
    try { unlinkSync(TEST_DB); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  });

  describe('upsertJournalEntry', () => {
    it('inserts a new journal entry', async () => {
      const { entry, skipped } = await upsertJournalEntry(makeInput());
      expect(skipped).toBe(false);
      expect(entry.id).toBeDefined();
      expect(entry.kind).toBe('daily');
      expect(entry.scope_type).toBe('global');
      expect(entry.period_start_ymd).toBe('2026-02-17');
      expect(entry.model_id).toBe('test/model-1');
      expect(entry.content).toEqual({ schema_version: 1, headline: 'Test day' });
    });

    it('skips if same fingerprint (idempotent)', async () => {
      await upsertJournalEntry(makeInput());
      const { entry: entry2, skipped } = await upsertJournalEntry(makeInput());
      expect(skipped).toBe(true);
      expect(entry2).toBeDefined();
    });

    it('overwrites if fingerprint differs (re-run)', async () => {
      await upsertJournalEntry(makeInput({ input_fingerprint: 'fp-1', content: { headline: 'v1' } }));
      const { entry, skipped } = await upsertJournalEntry(makeInput({ input_fingerprint: 'fp-2', content: { headline: 'v2' } }));
      expect(skipped).toBe(false);
      expect(entry.input_fingerprint).toBe('fp-2');
      expect(entry.content).toEqual({ headline: 'v2' });
    });

    it('allows entries for different scopes to coexist', async () => {
      // Create a real pot so the FK constraint on audit_events.pot_id is satisfied
      const pot = await createPot({ name: 'Test Pot' });

      await upsertJournalEntry(makeInput({ scope_type: 'global', scope_id: undefined }));
      await upsertJournalEntry(makeInput({ scope_type: 'pot', scope_id: pot.id, input_fingerprint: 'fp-pot-1' }));

      const globalEntry = await getJournalEntry({ kind: 'daily', scope_type: 'global', scope_id: null, period_start_ymd: '2026-02-17' });
      const potEntry = await getJournalEntry({ kind: 'daily', scope_type: 'pot', scope_id: pot.id, period_start_ymd: '2026-02-17' });

      expect(globalEntry).toBeDefined();
      expect(potEntry).toBeDefined();
      expect(globalEntry!.id).not.toBe(potEntry!.id);
    });
  });

  describe('getJournalEntry', () => {
    it('returns null when no entry exists', async () => {
      const entry = await getJournalEntry({ kind: 'daily', scope_type: 'global', scope_id: null, period_start_ymd: '2099-01-01' });
      expect(entry).toBeNull();
    });

    it('returns the entry when found', async () => {
      await upsertJournalEntry(makeInput());
      const entry = await getJournalEntry({ kind: 'daily', scope_type: 'global', scope_id: null, period_start_ymd: '2026-02-17' });
      expect(entry).not.toBeNull();
      expect(entry!.kind).toBe('daily');
    });
  });

  describe('getJournalEntryById', () => {
    it('returns null for unknown ID', async () => {
      const result = await getJournalEntryById('does-not-exist');
      expect(result).toBeNull();
    });

    it('returns entry by ID', async () => {
      const { entry } = await upsertJournalEntry(makeInput());
      const fetched = await getJournalEntryById(entry.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(entry.id);
    });
  });

  describe('listJournalEntries', () => {
    it('returns entries in descending period order', async () => {
      await upsertJournalEntry(makeInput({ period_start_ymd: '2026-02-01', period_end_ymd: '2026-02-01', input_fingerprint: 'fp-1' }));
      await upsertJournalEntry(makeInput({ period_start_ymd: '2026-02-02', period_end_ymd: '2026-02-02', input_fingerprint: 'fp-2' }));

      const entries = await listJournalEntries({ scope_type: 'global' });
      expect(entries.length).toBeGreaterThanOrEqual(2);
      // Should be descending by period_start_ymd
      expect(entries[0].period_start_ymd >= entries[1].period_start_ymd).toBe(true);
    });

    it('filters by kind', async () => {
      await upsertJournalEntry(makeInput({ kind: 'daily', input_fingerprint: 'fp-d' }));
      await upsertJournalEntry(makeInput({ kind: 'weekly', period_end_ymd: '2026-02-23', input_fingerprint: 'fp-w' }));

      const dailyOnly = await listJournalEntries({ scope_type: 'global', kind: 'daily' });
      expect(dailyOnly.every((e) => e.kind === 'daily')).toBe(true);
    });
  });

  describe('listChildJournalEntries', () => {
    it('returns daily entries within a week range', async () => {
      // Insert 3 daily notes
      for (const [date, fp] of [['2026-02-10', 'fp-10'], ['2026-02-11', 'fp-11'], ['2026-02-12', 'fp-12']]) {
        await upsertJournalEntry(makeInput({ period_start_ymd: date, period_end_ymd: date, input_fingerprint: fp }));
      }
      // One outside range
      await upsertJournalEntry(makeInput({ period_start_ymd: '2026-02-09', period_end_ymd: '2026-02-09', input_fingerprint: 'fp-09' }));

      const children = await listChildJournalEntries({
        child_kind: 'daily',
        scope_type: 'global',
        scope_id: null,
        period_start_ymd: '2026-02-10',
        period_end_ymd: '2026-02-16',
      });

      expect(children.length).toBe(3);
      expect(children.map((c) => c.period_start_ymd).sort()).toEqual(['2026-02-10', '2026-02-11', '2026-02-12']);
    });
  });

  describe('journalEntryExistsByFingerprint', () => {
    it('returns false when entry does not exist', async () => {
      const exists = await journalEntryExistsByFingerprint('daily', 'global', null, '2099-01-01', 'some-fp');
      expect(exists).toBe(false);
    });

    it('returns true when entry with same fingerprint exists', async () => {
      await upsertJournalEntry(makeInput({ input_fingerprint: 'unique-fp-xyz' }));
      const exists = await journalEntryExistsByFingerprint('daily', 'global', null, '2026-02-17', 'unique-fp-xyz');
      expect(exists).toBe(true);
    });

    it('returns false when entry exists but fingerprint differs', async () => {
      await upsertJournalEntry(makeInput({ input_fingerprint: 'fp-aaa' }));
      const exists = await journalEntryExistsByFingerprint('daily', 'global', null, '2026-02-17', 'fp-bbb');
      expect(exists).toBe(false);
    });
  });
});
