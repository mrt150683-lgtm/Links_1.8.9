/**
 * DYK Worker Job Tests
 *
 * Tests:
 *   dyk_generate_for_entry — validates schema, inserts items, skips low novelty
 *   dyk_inbox_tick         — selects one eligible DYK, creates notification, advances timer
 *   dyk_inbox_tick         — is idempotent: second tick within interval skips
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import {
  initDatabase,
  closeDatabase,
  runMigrations,
  createPot,
  createTextEntryIdempotent,
  insertDykItems,
  computeDykSignature,
  listDykNotifications,
  getNextEligibleDyk,
  getPotDykState,
} from '@links/storage';

const TEST_DB = `./test-worker-dyk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@links/logging', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@links/ai', () => ({
  createChatCompletion: vi.fn(),
  loadPromptFromFile: vi.fn(),
  interpolatePrompt: vi.fn(),
  resolveEffectiveRole: vi.fn(),
  injectRoleIntoSystemPrompt: vi.fn(),
}));

// ── Test infrastructure ────────────────────────────────────────────────

let potId: string;
let entryId: string;

beforeEach(() => {
  initDatabase({ filename: TEST_DB });
  runMigrations();
});

afterEach(() => {
  closeDatabase();
  vi.clearAllMocks();
  try { unlinkSync(TEST_DB); } catch { /* ignore */ }
  try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
  try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
});

// ── dyk_generate_for_entry ─────────────────────────────────────────────

describe('dyk_generate_for_entry', () => {
  beforeEach(async () => {
    const pot = await createPot({ name: 'Test Pot' });
    potId = pot.id;
    const entry = await createTextEntryIdempotent({
      pot_id: potId,
      content_text: 'Quantum computing uses qubits instead of classical bits. This allows superposition and entanglement for exponential speedup in certain algorithms.',
      capture_method: 'test',
    });
    entryId = entry.entry.id;
  });

  it('validates AI output schema and inserts items (mocked AI)', async () => {
    const { createChatCompletion, loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } = await import('@links/ai');

    vi.mocked(resolveEffectiveRole).mockResolvedValue({ hash: 'testhash', text: '' });
    vi.mocked(injectRoleIntoSystemPrompt).mockReturnValue('system prompt');
    vi.mocked(loadPromptFromFile).mockReturnValue({
      metadata: { id: 'dyk_generate_from_entry', version: 1, temperature: 0.3, max_tokens: 2000, response_format: 'json_object' },
      rawContent: '',
    } as any);
    vi.mocked(interpolatePrompt).mockReturnValue({ system: '', user: '' });
    vi.mocked(createChatCompletion).mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                title: 'Did you know qubits enable superposition',
                body: 'Unlike classical bits, qubits can exist in multiple states simultaneously.',
                keywords: ['qubit', 'superposition', 'quantum'],
                confidence: 0.88,
                novelty_hint: 0.9,
                why_relevant: 'Core concept in quantum computing',
                source_evidence: [],
              },
              {
                title: 'Did you know quantum entanglement enables speedup',
                body: 'Entanglement correlates qubits for exponential algorithm speedup.',
                keywords: ['entanglement', 'quantum', 'algorithm', 'speedup'],
                confidence: 0.85,
                novelty_hint: 0.85,
                why_relevant: 'Key mechanism for quantum advantage',
                source_evidence: [],
              },
            ],
          }),
        },
      }],
    } as any);

    const { dykGenerateForEntryHandler } = await import('../src/jobs/dykGenerateForEntry.js');

    await dykGenerateForEntryHandler({
      jobId: 'test-job-1',
      jobType: 'dyk_generate_for_entry',
      entryId,
      potId,
      payload: {},
      attempt: 1,
    } as any);

    // Both items should be inserted (no existing novelty baseline)
    const next = await getNextEligibleDyk(potId);
    expect(next).not.toBeNull();
    expect(next!.title).toContain('Did you know');
  });

  it('skips entry with content_text shorter than 50 chars', async () => {
    const shortEntry = await createTextEntryIdempotent({
      pot_id: potId,
      content_text: 'Short.',
      capture_method: 'test',
    });

    const { dykGenerateForEntryHandler } = await import('../src/jobs/dykGenerateForEntry.js');

    await expect(dykGenerateForEntryHandler({
      jobId: 'test-job-short',
      jobType: 'dyk_generate_for_entry',
      entryId: shortEntry.entry.id,
      potId,
      payload: {},
      attempt: 1,
    } as any)).resolves.toBeUndefined(); // Returns without error

    // No DYK items inserted for short entry
    const next = await getNextEligibleDyk(potId);
    expect(next).toBeNull();
  });

  it('filters low-novelty items against existing DYK items', async () => {
    // Pre-insert an existing item with same keywords
    const existingSig = computeDykSignature('Existing', 'Body', ['qubit', 'superposition', 'quantum'], 'entry_summary', '0', null);
    await insertDykItems([{
      pot_id: potId,
      entry_id: entryId,
      title: 'Existing insight',
      body: 'Existing body.',
      keywords: ['qubit', 'superposition', 'quantum'],
      confidence: 0.9,
      novelty: 1,
      source_type: 'entry_summary',
      signature: existingSig,
      model_id: 'm',
      prompt_id: 'p',
      prompt_version: '0',
    }]);

    // Mark as shown so it counts for novelty baseline
    const { getDatabase } = await import('@links/storage');

    const { createChatCompletion, loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } = await import('@links/ai');

    vi.mocked(resolveEffectiveRole).mockResolvedValue({ hash: 'h', text: '' });
    vi.mocked(injectRoleIntoSystemPrompt).mockReturnValue('sys');
    vi.mocked(loadPromptFromFile).mockReturnValue({
      metadata: { id: 'dyk_generate_from_entry', version: 1, temperature: 0.3, max_tokens: 2000, response_format: 'json_object' },
      rawContent: '',
    } as any);
    vi.mocked(interpolatePrompt).mockReturnValue({ system: '', user: '' });
    vi.mocked(createChatCompletion).mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [{
              title: 'Did you know qubits use superposition',
              body: 'Very similar to existing.',
              keywords: ['qubit', 'superposition', 'quantum'], // Same as existing
              confidence: 0.9,
              source_evidence: [],
            }],
          }),
        },
      }],
    } as any);

    // Update existing item status to 'shown' so novelty baseline counts it
    const db = (await import('@links/storage')).getDatabase();
    await db.updateTable('dyk_items').set({ status: 'shown' }).where('pot_id', '=', potId).execute();

    const { dykGenerateForEntryHandler } = await import('../src/jobs/dykGenerateForEntry.js');
    await dykGenerateForEntryHandler({
      jobId: 'test-job-novelty',
      jobType: 'dyk_generate_for_entry',
      entryId,
      potId,
      payload: {},
      attempt: 1,
    } as any);

    // The new item should be filtered out due to low novelty (same keywords as existing)
    const items = await (await import('@links/storage')).listDykItems(potId);
    const newItems = items.filter((i) => i.status === 'new');
    // The low-novelty candidate (identical keywords to existing shown item) should be filtered
    // (The existing 'shown' item still exists but no new 'new' items should appear)
    expect(newItems).toHaveLength(0);
  });
});

// ── dyk_inbox_tick ─────────────────────────────────────────────────────

describe('dyk_inbox_tick', () => {
  beforeEach(async () => {
    const pot = await createPot({ name: 'Tick Pot' });
    potId = pot.id;
    const entry = await createTextEntryIdempotent({
      pot_id: potId,
      content_text: 'Machine learning algorithms learn from data.',
      capture_method: 'test',
    });
    entryId = entry.entry.id;
  });

  it('creates a notification when interval has elapsed and item is eligible', async () => {
    // Insert an eligible DYK item
    const sig = computeDykSignature('Did you know tick', 'ML body.', ['ml', 'learning'], 'entry_summary', '1', null);
    await insertDykItems([{
      pot_id: potId,
      entry_id: entryId,
      title: 'Did you know tick',
      body: 'ML body.',
      keywords: ['ml', 'learning'],
      confidence: 0.85,
      novelty: 0.9,
      source_type: 'entry_summary',
      signature: sig,
      model_id: 'm',
      prompt_id: 'p',
      prompt_version: '1',
    }]);

    // Ensure next_dyk_due_at is in the past (default 0, so it's already due)
    const { dykInboxTickHandler } = await import('../src/jobs/dykInboxTick.js');
    await dykInboxTickHandler({
      jobId: 'test-tick-1',
      jobType: 'dyk_inbox_tick',
      payload: {},
      attempt: 1,
    } as any);

    const notifications = await listDykNotifications(potId, { unread_only: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Did you know tick');
  });

  it('advances next_dyk_due_at after surfacing an insight', async () => {
    const sig = computeDykSignature('Timer test', 'body', ['timer'], 'entry_summary', '1', null);
    await insertDykItems([{
      pot_id: potId,
      entry_id: entryId,
      title: 'Did you know timer',
      body: 'Timer body.',
      keywords: ['timer'],
      confidence: 0.8,
      novelty: 0.8,
      source_type: 'entry_summary',
      signature: sig,
      model_id: 'm',
      prompt_id: 'p',
      prompt_version: '1',
    }]);

    const before = Date.now();
    const { dykInboxTickHandler } = await import('../src/jobs/dykInboxTick.js');
    await dykInboxTickHandler({
      jobId: 'test-tick-timer',
      jobType: 'dyk_inbox_tick',
      payload: {},
      attempt: 1,
    } as any);

    const state = await getPotDykState(potId);
    expect(state.next_dyk_due_at).toBeGreaterThan(before);
  });

  it('does not surface another notification within the interval', async () => {
    const sig1 = computeDykSignature('First tick', 'b1', ['a', 'b'], 'entry_summary', '1', null);
    const sig2 = computeDykSignature('Second tick', 'b2', ['c', 'd'], 'entry_summary', '1', null);

    await insertDykItems([
      { pot_id: potId, entry_id: entryId, title: 'Did you know first', body: 'b1.',
        keywords: ['a', 'b'], confidence: 0.8, novelty: 0.8, source_type: 'entry_summary',
        signature: sig1, model_id: 'm', prompt_id: 'p', prompt_version: '1' },
      { pot_id: potId, entry_id: entryId, title: 'Did you know second', body: 'b2.',
        keywords: ['c', 'd'], confidence: 0.7, novelty: 0.7, source_type: 'entry_summary',
        signature: sig2, model_id: 'm', prompt_id: 'p', prompt_version: '1' },
    ]);

    const { dykInboxTickHandler } = await import('../src/jobs/dykInboxTick.js');

    // First tick — should surface one item
    await dykInboxTickHandler({ jobId: 'tick-1', jobType: 'dyk_inbox_tick', payload: {}, attempt: 1 } as any);
    expect((await listDykNotifications(potId, { unread_only: true })).length).toBe(1);

    // Second tick — next_dyk_due_at is now in the future, should NOT surface another
    await dykInboxTickHandler({ jobId: 'tick-2', jobType: 'dyk_inbox_tick', payload: {}, attempt: 1 } as any);
    expect((await listDykNotifications(potId, { unread_only: true })).length).toBe(1); // Still just 1
  });
});
