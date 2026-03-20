/**
 * Phase 10: MCP Tools Integration Tests
 *
 * Tests all MCP tool handlers with real database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase, runMigrations } from '@links/storage';
import * as potsTools from '../src/tools/pots.js';
import * as captureTools from '../src/tools/capture.js';
import * as entriesTools from '../src/tools/entries.js';
import * as processingTools from '../src/tools/processing.js';

describe('MCP Tools - Pots', () => {
  beforeEach(async () => {
    initDatabase({ filename: ':memory:' });
    await runMigrations();
  });

  it('should create a pot', async () => {
    const result = await potsTools.createPot({ name: 'Test Pot' });
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('pot');
    if ('pot' in result) {
      expect(result.pot).toHaveProperty('id');
      expect(result.pot).toHaveProperty('name', 'Test Pot');
    }
  });

  it('should list pots', async () => {
    await potsTools.createPot({ name: 'Pot 1' });
    await potsTools.createPot({ name: 'Pot 2' });

    const result = await potsTools.listPots({ limit: 10, offset: 0 });
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('pots');
    if ('pots' in result) {
      expect(result.pots).toHaveLength(2);
    }
  });

  it('should get pot by id', async () => {
    const createResult = await potsTools.createPot({ name: 'Get Pot' });
    if (!('pot' in createResult)) throw new Error('Failed to create pot');

    const getResult = await potsTools.getPot({ pot_id: createResult.pot.id });
    expect(getResult).toHaveProperty('ok', true);
    expect(getResult).toHaveProperty('pot');
    if ('pot' in getResult) {
      expect(getResult.pot.name).toBe('Get Pot');
    }
  });

  it('should delete pot with name confirmation', async () => {
    const createResult = await potsTools.createPot({ name: 'Delete Pot' });
    if (!('pot' in createResult)) throw new Error('Failed to create pot');

    const deleteResult = await potsTools.deletePot({
      pot_id: createResult.pot.id,
      confirm_name: 'Delete Pot',
    });
    expect(deleteResult).toHaveProperty('ok', true);
    expect(deleteResult).toHaveProperty('deleted', true);
  });

  it('should reject delete with wrong name', async () => {
    const createResult = await potsTools.createPot({ name: 'Safe Pot' });
    if (!('pot' in createResult)) throw new Error('Failed to create pot');

    const deleteResult = await potsTools.deletePot({
      pot_id: createResult.pot.id,
      confirm_name: 'Wrong Name',
    });
    expect(deleteResult).toHaveProperty('ok', false);
  });
});

describe('MCP Tools - Capture', () => {
  let potId: string;

  beforeEach(async () => {
    initDatabase({ filename: ':memory:' });
    await runMigrations();

    // Create test pot
    const result = await potsTools.createPot({ name: 'Capture Pot' });
    if (!('pot' in result)) throw new Error('Failed to create pot');
    potId = result.pot.id;
  });

  it('should capture text', async () => {
    const result = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Test content',
      capture_method: 'mcp',
    });

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('entry');
    if ('entry' in result) {
      expect(result.entry).toHaveProperty('content_text', 'Test content');
      expect(result.entry).toHaveProperty('type', 'text');
    }
  });

  it('should capture text with metadata', async () => {
    const result = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Article quote',
      capture_method: 'mcp',
      source_url: 'https://example.com/article',
      source_title: 'Example Article',
      notes: 'Important quote',
    });

    expect(result).toHaveProperty('ok', true);
    if ('entry' in result) {
      expect(result.entry).toHaveProperty('source_url', 'https://example.com/article');
      expect(result.entry).toHaveProperty('notes', 'Important quote');
    }
  });

  it('should capture link', async () => {
    const result = await captureTools.captureLink({
      pot_id: potId,
      source_url: 'https://example.com',
      capture_method: 'mcp',
      source_title: 'Example Site',
    });

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('entry');
    if ('entry' in result) {
      expect(result.entry).toHaveProperty('source_url', 'https://example.com');
      expect(result.entry).toHaveProperty('content_text', 'https://example.com');
    }
  });

  it('should support idempotent capture', async () => {
    const clientId = 'test-capture-123';

    const result1 = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Idempotent content',
      capture_method: 'mcp',
      client_capture_id: clientId,
    });

    const result2 = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Idempotent content',
      capture_method: 'mcp',
      client_capture_id: clientId,
    });

    expect(result1).toHaveProperty('ok', true);
    expect(result2).toHaveProperty('ok', true);

    if ('entry' in result1 && 'entry' in result2) {
      expect(result1.entry.id).toBe(result2.entry.id);
    }
  });
});

describe('MCP Tools - Entries', () => {
  let potId: string;
  let entryId: string;

  beforeEach(async () => {
    initDatabase({ filename: ':memory:' });
    await runMigrations();

    // Create test pot and entry
    const potResult = await potsTools.createPot({ name: 'Entries Pot' });
    if (!('pot' in potResult)) throw new Error('Failed to create pot');
    potId = potResult.pot.id;

    const entryResult = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Test entry',
      capture_method: 'mcp',
    });
    if (!('entry' in entryResult)) throw new Error('Failed to create entry');
    entryId = entryResult.entry.id;
  });

  it('should list entries', async () => {
    const result = await entriesTools.listEntries({
      pot_id: potId,
      limit: 10,
      offset: 0,
    });

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('entries');
    if ('entries' in result) {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toHaveProperty('content_text', 'Test entry');
    }
  });

  it('should get entry by id', async () => {
    const result = await entriesTools.getEntry({ entry_id: entryId });

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('entry');
    if ('entry' in result) {
      expect(result.entry).toHaveProperty('id', entryId);
      expect(result.entry).toHaveProperty('content_text', 'Test entry');
    }
  });

  it('should filter entries by capture_method', async () => {
    await captureTools.captureText({
      pot_id: potId,
      content_text: 'API entry',
      capture_method: 'api',
    });

    const result = await entriesTools.listEntries({
      pot_id: potId,
      capture_method: 'mcp',
      limit: 10,
      offset: 0,
    });

    if ('entries' in result) {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].capture_method).toBe('mcp');
    }
  });
});

describe('MCP Tools - Processing', () => {
  let potId: string;
  let entryId: string;

  beforeEach(async () => {
    initDatabase({ filename: ':memory:' });
    await runMigrations();

    // Create test pot and entry
    const potResult = await potsTools.createPot({ name: 'Processing Pot' });
    if (!('pot' in potResult)) throw new Error('Failed to create pot');
    potId = potResult.pot.id;

    const entryResult = await captureTools.captureText({
      pot_id: potId,
      content_text: 'Process me',
      capture_method: 'mcp',
    });
    if (!('entry' in entryResult)) throw new Error('Failed to create entry');
    entryId = entryResult.entry.id;
  });

  it('should enqueue processing job', async () => {
    const result = await processingTools.enqueueProcessing({
      job_type: 'extract_tags',
      entry_id: entryId,
      pot_id: potId,
    });

    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('job');
    if ('job' in result) {
      expect(result.job).toHaveProperty('job_type', 'extract_tags');
      expect(result.job).toHaveProperty('status', 'queued');
    }
  });

  it('should enqueue high-priority job for immediate processing', async () => {
    const result = await processingTools.runProcessingNow({
      job_type: 'generate_summary',
      entry_id: entryId,
      pot_id: potId,
    });

    expect(result).toHaveProperty('ok', true);
    if ('job' in result) {
      expect(result.job).toHaveProperty('priority', 1000);
      expect(result.job).toHaveProperty('job_type', 'generate_summary');
    }
  });
});

describe('MCP Tools - Error Handling', () => {
  beforeEach(async () => {
    initDatabase({ filename: ':memory:' });
    await runMigrations();
  });

  it('should return NOT_FOUND for missing pot', async () => {
    const result = await potsTools.getPot({ pot_id: '00000000-0000-0000-0000-000000000000' });
    expect(result).toHaveProperty('ok', false);
    if ('error' in result) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('should return VALIDATION_ERROR for invalid UUID', async () => {
    const result = await potsTools.getPot({ pot_id: 'not-a-uuid' });
    expect(result).toHaveProperty('ok', false);
    if ('error' in result) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should return VALIDATION_ERROR for missing required fields', async () => {
    const result = await captureTools.captureText({
      pot_id: '00000000-0000-0000-0000-000000000000',
      // Missing content_text and capture_method
    } as any);

    expect(result).toHaveProperty('ok', false);
    if ('error' in result) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
