import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase, runMigrations } from '../src/index.js';
import {
  createPot,
  getPotById,
  listPots,
  updatePot,
  deletePot,
  countPots,
} from '../src/repos/potsRepo.js';
import {
  createTextEntry,
  getEntryById,
  listEntries,
  deleteEntry,
  countEntriesByPot,
  findEntriesByHash,
} from '../src/repos/entriesRepo.js';
import { getAuditEventsByPot, getRecentAuditEvents } from '../src/repos/auditRepo.js';
import { hashText } from '../src/canonicalize.js';

const TEST_DB = './test-phase2.db';

describe('Storage Integration Tests', () => {
  beforeAll(() => {
    // Initialize test database
    initDatabase({ filename: TEST_DB });
    runMigrations();
  });

  afterAll(() => {
    closeDatabase();
    try {
      unlinkSync(TEST_DB);
      unlinkSync(TEST_DB + '-shm');
      unlinkSync(TEST_DB + '-wal');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Pots', () => {
    it('should create a pot', async () => {
      const pot = await createPot({
        name: 'Test Pot',
        description: 'A test research pot',
      });

      expect(pot.id).toBeDefined();
      expect(pot.name).toBe('Test Pot');
      expect(pot.description).toBe('A test research pot');
      expect(pot.security_level).toBe('standard');
      expect(pot.created_at).toBeTypeOf('number');
      expect(pot.updated_at).toBe(pot.created_at);
    });

    it('should get a pot by ID', async () => {
      const created = await createPot({ name: 'Get Test' });
      const fetched = await getPotById(created.id);

      expect(fetched).toEqual(created);
    });

    it('should return null for non-existent pot', async () => {
      const fetched = await getPotById('non-existent-id');
      expect(fetched).toBeNull();
    });

    it('should list pots', async () => {
      const before = await countPots();
      await createPot({ name: 'List Test 1' });
      await createPot({ name: 'List Test 2' });

      const pots = await listPots();
      expect(pots.length).toBeGreaterThanOrEqual(2);
      expect(await countPots()).toBe(before + 2);
    });

    it('should update a pot', async () => {
      const created = await createPot({ name: 'Update Test' });
      const updated = await updatePot(created.id, {
        name: 'Updated Name',
        description: 'New description',
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('New description');
      expect(updated?.updated_at).toBeGreaterThan(created.updated_at);
    });

    it('should return null when updating non-existent pot', async () => {
      const updated = await updatePot('non-existent', { name: 'Test' });
      expect(updated).toBeNull();
    });

    it('should delete a pot', async () => {
      const created = await createPot({ name: 'Delete Test' });
      const deleted = await deletePot(created.id);

      expect(deleted).toBe(true);

      const fetched = await getPotById(created.id);
      expect(fetched).toBeNull();
    });

    it('should return false when deleting non-existent pot', async () => {
      const deleted = await deletePot('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Entries', () => {
    it('should create a text entry with canonical hash', async () => {
      const pot = await createPot({ name: 'Entry Test Pot' });
      const text = 'This is a test entry\r\nWith multiple lines   \n\n\n\nAnd blank lines';

      const entry = await createTextEntry({
        pot_id: pot.id,
        content_text: text,
        capture_method: 'clipboard',
        source_url: 'https://example.com',
        source_title: 'Example Page',
        notes: 'Test notes',
      });

      expect(entry.id).toBeDefined();
      expect(entry.pot_id).toBe(pot.id);
      expect(entry.type).toBe('text');
      expect(entry.content_text).toBe(text);
      expect(entry.content_sha256).toBe(hashText(text));
      expect(entry.capture_method).toBe('clipboard');
      expect(entry.source_url).toBe('https://example.com');
      expect(entry.source_title).toBe('Example Page');
      expect(entry.notes).toBe('Test notes');
    });

    it('should produce same hash for equivalent text with different formatting', async () => {
      const pot = await createPot({ name: 'Hash Test Pot' });

      const text1 = 'line1\nline2\nline3';
      const text2 = 'line1\r\nline2\r\nline3';
      const text3 = 'line1   \nline2\t\nline3  ';

      const entry1 = await createTextEntry({
        pot_id: pot.id,
        content_text: text1,
        capture_method: 'test',
      });

      const entry2 = await createTextEntry({
        pot_id: pot.id,
        content_text: text2,
        capture_method: 'test',
      });

      const entry3 = await createTextEntry({
        pot_id: pot.id,
        content_text: text3,
        capture_method: 'test',
      });

      expect(entry1.content_sha256).toBe(entry2.content_sha256);
      expect(entry1.content_sha256).toBe(entry3.content_sha256);
    });

    it('should get an entry by ID', async () => {
      const pot = await createPot({ name: 'Get Entry Test' });
      const created = await createTextEntry({
        pot_id: pot.id,
        content_text: 'Test content',
        capture_method: 'manual',
      });

      const fetched = await getEntryById(created.id);
      expect(fetched).toEqual(created);
    });

    it('should list entries for a pot', async () => {
      const pot = await createPot({ name: 'List Entries Test' });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 1',
        capture_method: 'clipboard',
      });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 2',
        capture_method: 'manual',
      });

      const entries = await listEntries({ pot_id: pot.id });
      expect(entries.length).toBe(2);
    });

    it('should filter entries by capture_method', async () => {
      const pot = await createPot({ name: 'Filter Test' });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Clipboard entry',
        capture_method: 'clipboard',
      });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Manual entry',
        capture_method: 'manual',
      });

      const clipboardEntries = await listEntries({
        pot_id: pot.id,
        capture_method: 'clipboard',
      });

      expect(clipboardEntries.length).toBe(1);
      expect(clipboardEntries[0]?.capture_method).toBe('clipboard');
    });

    it('should delete an entry', async () => {
      const pot = await createPot({ name: 'Delete Entry Test' });
      const created = await createTextEntry({
        pot_id: pot.id,
        content_text: 'To be deleted',
        capture_method: 'test',
      });

      const deleted = await deleteEntry(created.id);
      expect(deleted).toBe(true);

      const fetched = await getEntryById(created.id);
      expect(fetched).toBeNull();
    });

    it('should cascade delete entries when pot is deleted', async () => {
      const pot = await createPot({ name: 'Cascade Test' });

      const entry1 = await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 1',
        capture_method: 'test',
      });

      const entry2 = await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 2',
        capture_method: 'test',
      });

      await deletePot(pot.id);

      expect(await getEntryById(entry1.id)).toBeNull();
      expect(await getEntryById(entry2.id)).toBeNull();
    });

    it('should find entries by hash', async () => {
      const pot = await createPot({ name: 'Hash Lookup Test' });
      const text = 'Duplicate content';

      const entry1 = await createTextEntry({
        pot_id: pot.id,
        content_text: text,
        capture_method: 'test',
      });

      const entry2 = await createTextEntry({
        pot_id: pot.id,
        content_text: text,
        capture_method: 'test',
      });

      const duplicates = await findEntriesByHash(pot.id, entry1.content_sha256);
      expect(duplicates.length).toBe(2);
    });

    it('should count entries by pot', async () => {
      const pot = await createPot({ name: 'Count Test' });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 1',
        capture_method: 'test',
      });

      await createTextEntry({
        pot_id: pot.id,
        content_text: 'Entry 2',
        capture_method: 'test',
      });

      const count = await countEntriesByPot(pot.id);
      expect(count).toBe(2);
    });
  });

  describe('Audit Events', () => {
    it('should log audit event when creating a pot', async () => {
      const pot = await createPot({ name: 'Audit Test Pot' });
      const events = await getAuditEventsByPot(pot.id);

      expect(events.length).toBeGreaterThanOrEqual(1);

      const createEvent = events.find((e) => e.action === 'create_pot');
      expect(createEvent).toBeDefined();
      expect(createEvent?.actor).toBe('user');
      expect(createEvent?.pot_id).toBe(pot.id);
    });

    it('should log audit event when creating an entry', async () => {
      const pot = await createPot({ name: 'Audit Entry Test' });
      const entry = await createTextEntry({
        pot_id: pot.id,
        content_text: 'Test',
        capture_method: 'test',
      });

      const events = await getAuditEventsByPot(pot.id);
      const createEntryEvent = events.find((e) => e.action === 'create_entry');

      expect(createEntryEvent).toBeDefined();
      expect(createEntryEvent?.entry_id).toBe(entry.id);
      expect(createEntryEvent?.metadata).toHaveProperty('capture_method', 'test');
    });

    it('should retrieve recent audit events', async () => {
      await createPot({ name: 'Recent Event Test 1' });
      await createPot({ name: 'Recent Event Test 2' });

      const recentEvents = await getRecentAuditEvents(10);
      expect(recentEvents.length).toBeGreaterThanOrEqual(2);
    });
  });
});
