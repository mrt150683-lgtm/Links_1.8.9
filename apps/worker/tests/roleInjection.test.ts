/**
 * Worker Tests: Role Injection (018_pot_role)
 *
 * Verifies that role text is injected into AI job system prompts,
 * and that role_hash is stored in derived artifacts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import {
  initDatabase,
  closeDatabase,
  runMigrations,
  createPot,
  updatePotRole,
  getPotById,
} from '@links/storage';

const TEST_DB = `./test-worker-role-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

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
const mockResolveEffectiveRole = vi.fn();
const mockInjectRoleIntoSystemPrompt = vi.fn();

vi.mock('@links/ai', () => ({
  createChatCompletion: (...args: any[]) => mockCreateChatCompletion(...args),
  loadPromptFromFile: (...args: any[]) => mockLoadPromptFromFile(...args),
  interpolatePrompt: (...args: any[]) => mockInterpolatePrompt(...args),
  resolveEffectiveRole: (...args: any[]) => mockResolveEffectiveRole(...args),
  injectRoleIntoSystemPrompt: (...args: any[]) => mockInjectRoleIntoSystemPrompt(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TAGS_RESPONSE = {
  tags: [{ label: 'test-tag', type: 'topic' as const, confidence: 0.9 }],
};

function setupPromptMock(baseSystem = 'Base system prompt.') {
  mockLoadPromptFromFile.mockReturnValue({
    metadata: {
      id: 'tag_entry',
      version: 1,
      description: 'Tag entry',
      created_at: '2026-01-01',
      temperature: 0.2,
      response_format: 'json_object',
    },
    system: baseSystem,
    user: 'Tag this: {{content_text}}',
  });

  mockInterpolatePrompt.mockReturnValue({
    system: baseSystem,
    user: 'Tag this: test content',
  });
}

function setupRoleMock(roleText: string, roleHash = 'abc123def456') {
  mockResolveEffectiveRole.mockResolvedValue({
    text: roleText,
    source: 'user' as const,
    ref: 'user:',
    hash: roleHash,
  });

  mockInjectRoleIntoSystemPrompt.mockImplementation(
    (base: string, role: string) =>
      role ? `[SYSTEM_BASELINE]\n${base}\n\n[POT_ROLE]\n${role}` : `[SYSTEM_BASELINE]\n${base}`
  );
}

function setupAiMock() {
  mockCreateChatCompletion.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(VALID_TAGS_RESPONSE) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Role injection in tagEntry handler', () => {
  beforeEach(async () => {
    initDatabase({ path: TEST_DB });
    await runMigrations();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    closeDatabase();
    try {
      unlinkSync(TEST_DB);
      unlinkSync(TEST_DB + '-shm');
      unlinkSync(TEST_DB + '-wal');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('passes system prompt containing [POT_ROLE] to createChatCompletion when role is set', async () => {
    const { tagEntryHandler } = await import('../src/jobs/tagEntry.js');
    const { createTextEntry } = await import('@links/storage');

    setupPromptMock('Be accurate and factual.');
    setupRoleMock('You are a forensic analyst.', 'deadbeef01234567deadbeef01234567deadbeef01234567deadbeef01234567');
    setupAiMock();

    const pot = await createPot({ name: 'Role Test Pot' });
    await updatePotRole(pot.id, {
      role_ref: 'user:',
      role_hash: 'deadbeef01234567deadbeef01234567deadbeef01234567deadbeef01234567',
      role_updated_at: Date.now(),
    });

    const entry = await createTextEntry({
      pot_id: pot.id,
      content_text: 'Some research content about forensics.',
      capture_method: 'manual',
    });

    await tagEntryHandler({ jobId: 'job-1', entryId: entry.id, potId: pot.id });

    // Verify createChatCompletion was called with injected role in system message
    expect(mockCreateChatCompletion).toHaveBeenCalledOnce();
    const call = mockCreateChatCompletion.mock.calls[0][0];
    const systemMessage = call.messages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('[POT_ROLE]');
    expect(systemMessage.content).toContain('You are a forensic analyst.');
    expect(systemMessage.content).toContain('[SYSTEM_BASELINE]');
    // SYSTEM_BASELINE always comes before POT_ROLE
    expect(systemMessage.content.indexOf('[SYSTEM_BASELINE]')).toBeLessThan(
      systemMessage.content.indexOf('[POT_ROLE]')
    );
  });

  it('stores role_hash in derived artifact', async () => {
    const { tagEntryHandler } = await import('../src/jobs/tagEntry.js');
    const { createTextEntry, listArtifactsForEntry } = await import('@links/storage');

    const roleHash = 'cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe';
    setupPromptMock();
    setupRoleMock('Research analyst role.', roleHash);
    setupAiMock();

    const pot = await createPot({ name: 'Role Hash Test Pot' });
    const entry = await createTextEntry({
      pot_id: pot.id,
      content_text: 'Content for role hash test.',
      capture_method: 'manual',
    });

    await tagEntryHandler({ jobId: 'job-2', entryId: entry.id, potId: pot.id });

    const artifacts = await listArtifactsForEntry(entry.id);
    const tagsArtifact = artifacts.find((a) => a.artifact_type === 'tags');
    expect(tagsArtifact).toBeDefined();
    expect(tagsArtifact?.role_hash).toBe(roleHash);
  });

  it('resolveEffectiveRole is called with the pot object', async () => {
    const { tagEntryHandler } = await import('../src/jobs/tagEntry.js');
    const { createTextEntry } = await import('@links/storage');

    setupPromptMock();
    setupRoleMock('', 'nullrole0000000000000000000000000000000000000000000000000000000');
    setupAiMock();

    const pot = await createPot({ name: 'Resolve Role Test' });
    const entry = await createTextEntry({
      pot_id: pot.id,
      content_text: 'Content.',
      capture_method: 'manual',
    });

    await tagEntryHandler({ jobId: 'job-3', entryId: entry.id, potId: pot.id });

    expect(mockResolveEffectiveRole).toHaveBeenCalledOnce();
    const resolveArg = mockResolveEffectiveRole.mock.calls[0][0];
    expect(resolveArg.id).toBe(pot.id);
  });
});
