import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

const TEST_DB = './test-api-entries.db';

describe('Entries API', () => {
  let server: FastifyInstance;
  let testPotId: string;

  beforeAll(async () => {
    server = await createServer({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: TEST_DB,
    });

    // Create a test pot for entries
    const response = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Entry Test Pot' },
    });

    const pot = JSON.parse(response.body);
    testPotId = pot.id;
  });

  afterAll(async () => {
    await server.close();
    try {
      unlinkSync(TEST_DB);
      unlinkSync(TEST_DB + '-shm');
      unlinkSync(TEST_DB + '-wal');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('POST /pots/:potId/entries/text', () => {
    it('should create a text entry with all fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: {
          text: 'This is a test entry',
          capture_method: 'clipboard',
          source_url: 'https://example.com',
          source_title: 'Example Page',
          notes: 'Test notes',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.pot_id).toBe(testPotId);
      expect(body.type).toBe('text');
      expect(body.content_text).toBe('This is a test entry');
      expect(body.content_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(body.capture_method).toBe('clipboard');
      expect(body.source_url).toBe('https://example.com');
      expect(body.source_title).toBe('Example Page');
      expect(body.notes).toBe('Test notes');
      expect(body.captured_at).toBeTypeOf('number');
      expect(body.created_at).toBeTypeOf('number');
    });

    it('should create a text entry with minimal fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: {
          text: 'Minimal entry',
          capture_method: 'manual',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.content_text).toBe('Minimal entry');
      expect(body.source_url).toBeNull();
      expect(body.source_title).toBeNull();
      expect(body.notes).toBeNull();
    });

    it('should compute canonical hash correctly', async () => {
      const text1 = 'line1\nline2';
      const text2 = 'line1\r\nline2';

      const response1 = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: text1, capture_method: 'test' },
      });

      const response2 = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: text2, capture_method: 'test' },
      });

      const entry1 = JSON.parse(response1.body);
      const entry2 = JSON.parse(response2.body);

      expect(entry1.content_sha256).toBe(entry2.content_sha256);
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/pots/00000000-0000-0000-0000-000000000000/entries/text',
        payload: {
          text: 'Test',
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject invalid request (missing text)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: {
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /pots/:potId/entries', () => {
    it('should list entries for a pot', async () => {
      await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'Entry 1', capture_method: 'test' },
      });

      await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'Entry 2', capture_method: 'test' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/pots/${testPotId}/entries`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.entries).toBeInstanceOf(Array);
      expect(body.entries.length).toBeGreaterThanOrEqual(2);
      expect(body.total).toBeGreaterThanOrEqual(2);
      expect(body.pot_id).toBe(testPotId);
    });

    it('should filter by capture_method', async () => {
      await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'Clipboard entry', capture_method: 'clipboard' },
      });

      await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'Manual entry', capture_method: 'manual' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/pots/${testPotId}/entries?capture_method=clipboard`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.entries.every((e: any) => e.capture_method === 'clipboard')).toBe(true);
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots/00000000-0000-0000-0000-000000000000/entries',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /entries/:entryId', () => {
    it('should get an entry by ID', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'Get test', capture_method: 'test' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'GET',
        url: `/entries/${created.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
      expect(body.content_text).toBe('Get test');
    });

    it('should return 404 for non-existent entry', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/entries/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /entries/:entryId', () => {
    it('should delete an entry', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: `/pots/${testPotId}/entries/text`,
        payload: { text: 'To delete', capture_method: 'test' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'DELETE',
        url: `/entries/${created.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const getResponse = await server.inject({
        method: 'GET',
        url: `/entries/${created.id}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 for non-existent entry', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/entries/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
