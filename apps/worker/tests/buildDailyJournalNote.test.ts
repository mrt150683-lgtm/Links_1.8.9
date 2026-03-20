/**
 * Journal Module: Daily Journal Note Handler Unit Tests
 * Uses in-memory SQLite and mocked AI client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase, runMigrations, enqueueJob, setPreference, getJournalEntry } from '@links/storage';

const TEST_DB = `./test-worker-journal-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@links/logging', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockCreateChatCompletion = vi.fn();
const mockLoadPromptFromFile = vi.fn();
const mockInterpolatePrompt = vi.fn();

vi.mock('@links/ai', () => ({
  createChatCompletion: (...args: any[]) => mockCreateChatCompletion(...args),
  loadPromptFromFile: (...args: any[]) => mockLoadPromptFromFile(...args),
  interpolatePrompt: (...args: any[]) => mockInterpolatePrompt(...args),
}));

// ---------------------------------------------------------------------------
// Helper: valid daily note JSON
// ---------------------------------------------------------------------------

const VALID_DAILY_NOTE = {
  schema_version: 1,
  date_ymd: '2026-02-17',
  scope: { type: 'global' },
  headline: 'A test day',
  what_happened: [
    { bullet: 'Did some work', citations: [{ entry_id: 'entry-1' }] },
  ],
  open_loops: [],
  key_tags: [],
  key_entities: [],
  notable_sources: [],
  related_links_graph: [],
  stats: { entries_total: 1, entries_by_type: { text: 1 }, artifacts_by_type: {} },
  missing_or_unhandled: [],
  next_suggested_actions: [],
};

function setupAiMock(content: unknown = VALID_DAILY_NOTE): void {
  mockLoadPromptFromFile.mockReturnValue({
    metadata: {
      id: 'journal_daily_v1',
      version: 1,
      temperature: 0.2,
      max_tokens: 1800,
      response_format: 'json_object',
    },
    system: 'System prompt',
    user: 'User prompt {{date_ymd}}',
  });

  mockInterpolatePrompt.mockReturnValue({
    system: 'System prompt',
    user: 'User prompt 2026-02-17',
  });

  mockCreateChatCompletion.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.DATABASE_PATH = TEST_DB;
  initDatabase({ filename: TEST_DB });
  runMigrations();
  vi.clearAllMocks();
});

afterEach(async () => {
  closeDatabase();
  vi.resetAllMocks();
  for (const suffix of ['', '-shm', '-wal']) {
    try { unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDailyJournalNoteHandler', () => {
  it('skips when journal is disabled in processing.config', async () => {
    await setPreference('processing.config', { journal: { enabled: false } });

    // Enqueue a job with payload
    const job = await enqueueJob({
      job_type: 'build_daily_journal_note',
      payload: { kind: 'daily', scope_type: 'global', date_ymd: '2026-02-17', timezone: 'UTC' },
    });

    // Import after mocks are set
    const { buildDailyJournalNoteHandler } = await import('../src/jobs/buildDailyJournalNote.js');

    await buildDailyJournalNoteHandler({ jobId: job.id, potId: null, entryId: null, attempt: 1 });

    // AI should NOT have been called
    expect(mockCreateChatCompletion).not.toHaveBeenCalled();

    // No journal entry should exist
    const entry = await getJournalEntry({ kind: 'daily', scope_type: 'global', scope_id: null, period_start_ymd: '2026-02-17' });
    expect(entry).toBeNull();
  });

  it('skips when no entries exist for the day', async () => {
    await setPreference('processing.config', { journal: { enabled: true } });
    setupAiMock();

    const job = await enqueueJob({
      job_type: 'build_daily_journal_note',
      payload: { kind: 'daily', scope_type: 'global', date_ymd: '2099-01-01', timezone: 'UTC' },
    });

    const { buildDailyJournalNoteHandler } = await import('../src/jobs/buildDailyJournalNote.js');

    await buildDailyJournalNoteHandler({ jobId: job.id, potId: null, entryId: null, attempt: 1 });

    // AI should NOT have been called (no entries)
    expect(mockCreateChatCompletion).not.toHaveBeenCalled();
  });

  it('throws when AI returns invalid JSON', async () => {
    await setPreference('processing.config', { journal: { enabled: true } });

    mockLoadPromptFromFile.mockReturnValue({
      metadata: { id: 'journal_daily_v1', version: 1, temperature: 0.2, max_tokens: 1800, response_format: 'json_object' },
      system: 'System',
      user: 'User',
    });
    mockInterpolatePrompt.mockReturnValue({ system: 'System', user: 'User' });
    mockCreateChatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'not valid json {{{{' } }],
    });

    // Insert an entry so the job proceeds to AI call
    const db = (await import('@links/storage')).getDatabase();

    // Create pot first (FK constraint)
    const now = Date.now();
    await db.insertInto('pots').values({ id: 'pot-test', name: 'Test Pot', description: null, created_at: now, updated_at: now }).execute();

    await db.insertInto('entries').values({
      id: 'test-entry-1',
      pot_id: 'pot-test',
      type: 'text',
      content_text: 'Test content for today',
      content_sha256: 'abc123',
      capture_method: 'manual',
      source_url: null,
      source_title: null,
      notes: null,
      captured_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
      client_capture_id: null,
      source_app: null,
      source_context_json: null,
      asset_id: null,
      link_url: null,
      link_title: null,
    }).execute();

    const job = await enqueueJob({
      job_type: 'build_daily_journal_note',
      payload: { kind: 'daily', scope_type: 'global', date_ymd: new Date().toISOString().slice(0, 10), timezone: 'UTC' },
    });

    const { buildDailyJournalNoteHandler } = await import('../src/jobs/buildDailyJournalNote.js');

    await expect(
      buildDailyJournalNoteHandler({ jobId: job.id, potId: null, entryId: null, attempt: 1 })
    ).rejects.toThrow('invalid JSON');
  });

  it('throws when AI returns schema-invalid JSON', async () => {
    await setPreference('processing.config', { journal: { enabled: true } });
    // Note: schema_version: 99 is invalid
    setupAiMock({ schema_version: 99, date_ymd: '2026-02-17', scope: { type: 'global' } });

    const db = (await import('@links/storage')).getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    // Create pot first (FK constraint)
    const now2 = Date.now();
    await db.insertInto('pots').values({ id: 'pot-test', name: 'Test Pot', description: null, created_at: now2, updated_at: now2 }).execute();

    await db.insertInto('entries').values({
      id: 'test-entry-schema-fail',
      pot_id: 'pot-test',
      type: 'text',
      content_text: 'Content',
      content_sha256: 'hash-sf',
      capture_method: 'manual',
      source_url: null,
      source_title: null,
      notes: null,
      captured_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
      client_capture_id: null,
      source_app: null,
      source_context_json: null,
      asset_id: null,
      link_url: null,
      link_title: null,
    }).execute();

    const job = await enqueueJob({
      job_type: 'build_daily_journal_note',
      payload: { kind: 'daily', scope_type: 'global', date_ymd: today, timezone: 'UTC' },
    });

    const { buildDailyJournalNoteHandler } = await import('../src/jobs/buildDailyJournalNote.js');

    await expect(
      buildDailyJournalNoteHandler({ jobId: job.id, potId: null, entryId: null, attempt: 1 })
    ).rejects.toThrow('validation failed');
  });
});
