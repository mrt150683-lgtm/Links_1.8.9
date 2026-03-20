/**
 * Phase 6: Models API Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { unlinkSync } from 'node:fs';
import { replaceAllModels, clearModelsCache } from '@links/storage';

const TEST_DB_PATH = `./test-api-models-${Date.now()}-${Math.random().toString(36).substring(7)}.db`;

describe('Models API', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    const config = getConfig();
    server = await createServer(config);
    await server.ready();

    // Clear models cache before each test
    await clearModelsCache();
  });

  afterEach(async () => {
    await server.close();
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('GET /models', () => {
    it('should return empty list when cache is empty', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/models',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.models).toEqual([]);
      expect(body.cache.count).toBe(0);
      expect(body.cache.last_fetch).toBeNull();
    });

    it('should return cached models', async () => {
      // Populate cache
      await replaceAllModels([
        {
          name: 'anthropic/claude-3-5-sonnet',
          context_length: 200000,
          pricing_prompt: 0.000003,
          pricing_completion: 0.000015,
          supports_vision: true,
          supports_tools: true,
        },
        {
          name: 'openai/gpt-4-turbo',
          context_length: 128000,
        },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: '/models',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.models).toHaveLength(2);
      expect(body.cache.count).toBe(2);
      expect(body.cache.last_fetch).toBeGreaterThan(0);

      // Verify models are sorted by name
      expect(body.models[0].name).toBe('anthropic/claude-3-5-sonnet');
      expect(body.models[1].name).toBe('openai/gpt-4-turbo');
    });
  });

  describe('POST /models/refresh', () => {
    it('should enqueue refresh job with manual trigger', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/models/refresh',
        payload: {
          trigger: 'manual',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.job).toBeDefined();
      expect(body.job.id).toBeDefined();
      expect(body.job.status).toBe('queued');
      expect(body.message).toBe('Model refresh job enqueued');
    });

    it('should enqueue refresh job with scheduled trigger', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/models/refresh',
        payload: {
          trigger: 'scheduled',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.job).toBeDefined();
    });

    it('should default to manual trigger if not specified', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/models/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(201);
    });

    it('should reject invalid trigger value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/models/refresh',
        payload: {
          trigger: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
    });
  });
});
