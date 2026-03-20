import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { closeDatabase } from '@links/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Capture API', () => {
  let server: FastifyInstance;
  const testDbPath = path.join(process.cwd(), 'test-capture.db');

  beforeAll(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const config = getConfig();
    config.DATABASE_PATH = testDbPath;
    server = await createServer(config);
  });

  afterAll(async () => {
    await server.close();
    closeDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('GET /capture/pots', () => {
    it('should return pots sorted by last_used_at', async () => {
      // Create two pots
      const pot1Response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Pot 1' },
      });
      const pot1 = JSON.parse(pot1Response.body);

      const pot2Response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Pot 2' },
      });
      const pot2 = JSON.parse(pot2Response.body);

      // Capture to pot2 (should update last_used_at)
      await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot2.id,
          text: 'Test content',
          capture_method: 'test',
        },
      });

      // Get pot picker
      const response = await server.inject({
        method: 'GET',
        url: '/capture/pots',
      });

      expect(response.statusCode).toBe(200);
      const pots = JSON.parse(response.body);
      expect(pots).toHaveLength(2);
      expect(pots[0].id).toBe(pot2.id); // pot2 should be first (recently used)
      expect(pots[1].id).toBe(pot1.id);
      expect(pots[0].last_used_at).not.toBeNull();
      expect(pots[1].last_used_at).toBeNull();
    });

    it('should respect limit parameter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/capture/pots?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const pots = JSON.parse(response.body);
      expect(pots.length).toBeLessThanOrEqual(1);
    });
  });

  describe('POST /capture/text', () => {
    it('should create entry with all fields', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Test Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Capture text
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Test capture content',
          capture_method: 'clipboard',
          source_app: 'TestApp',
          source_context: { window: 'main' },
          client_capture_id: 'test-capture-1',
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.created).toBe(true);
      expect(result.deduped).toBe(false);
      expect(result.entry.content_text).toBe('Test capture content');
      expect(result.entry.source_app).toBe('TestApp');
      expect(result.entry.client_capture_id).toBe('test-capture-1');
      expect(result.entry.source_context).toEqual({ window: 'main' });
    });

    it('should dedupe by client_capture_id', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Dedupe Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // First capture
      const response1 = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Dedupe test',
          capture_method: 'test',
          client_capture_id: 'dedupe-123',
        },
      });

      expect(response1.statusCode).toBe(201);
      const result1 = JSON.parse(response1.body);
      expect(result1.created).toBe(true);
      expect(result1.deduped).toBe(false);

      // Second capture with same client_capture_id
      const response2 = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Dedupe test modified', // different content
          capture_method: 'test',
          client_capture_id: 'dedupe-123',
        },
      });

      expect(response2.statusCode).toBe(200);
      const result2 = JSON.parse(response2.body);
      expect(result2.created).toBe(false);
      expect(result2.deduped).toBe(true);
      expect(result2.dedupe_reason).toBe('client_capture_id');
      expect(result2.entry.id).toBe(result1.entry.id);
      expect(result2.entry.content_text).toBe('Dedupe test'); // original content
    });

    it('should dedupe by hash window', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Hash Window Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // First capture (no client_capture_id)
      const response1 = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Hash window test',
          capture_method: 'test',
        },
      });

      expect(response1.statusCode).toBe(201);
      const result1 = JSON.parse(response1.body);
      expect(result1.created).toBe(true);

      // Second capture within 60 seconds, same content
      const response2 = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Hash window test',
          capture_method: 'test',
        },
      });

      expect(response2.statusCode).toBe(200);
      const result2 = JSON.parse(response2.body);
      expect(result2.created).toBe(false);
      expect(result2.deduped).toBe(true);
      expect(result2.dedupe_reason).toBe('hash_window');
      expect(result2.entry.id).toBe(result1.entry.id);
    });

    it('should reject invalid captured_at', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Time Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Capture with timestamp 8 days in past
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: 'Old content',
          capture_method: 'test',
          captured_at: eightDaysAgo,
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('captured_at must be within 7 days');
    });

    it('should reject empty text after trim', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Empty Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Capture with whitespace-only text
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: pot.id,
          text: '   \n\t  ',
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('text must be non-empty');
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text',
        payload: {
          pot_id: '00000000-0000-0000-0000-000000000000',
          text: 'Test',
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('Pot not found');
    });
  });

  describe('POST /capture/text/auto', () => {
    it('should reject when autosave disabled', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Autosave Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Try autosave (autosave is disabled by default)
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text/auto',
        payload: {
          pot_id: pot.id,
          text: 'Autosave test',
          capture_method: 'autosave',
        },
      });

      expect(response.statusCode).toBe(409);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('AutosaveDisabled');
    });

    it('should create entry when autosave enabled', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Autosave Enabled Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Enable autosave globally
      await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          autosave: {
            enabled: true,
          },
        },
      });

      // Autosave should now work
      const response = await server.inject({
        method: 'POST',
        url: '/capture/text/auto',
        payload: {
          pot_id: pot.id,
          text: 'Autosave enabled test',
          capture_method: 'autosave',
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.created).toBe(true);
      expect(result.entry.content_text).toBe('Autosave enabled test');
    });
  });
});
