/**
 * Phase 6: AI Preferences API Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { unlinkSync } from 'node:fs';

const TEST_DB_PATH = `./test-api-ai-prefs-${Date.now()}-${Math.random().toString(36).substring(7)}.db`;

describe('AI Preferences API', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    const config = getConfig();
    server = await createServer(config);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('GET /prefs/ai', () => {
    it('should return default preferences when not set', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/prefs/ai',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('temperature', 0.2);
      expect(body).toHaveProperty('max_tokens', 4000);
    });

    it('should return updated preferences after PUT', async () => {
      // Set preferences
      await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          default_model: 'anthropic/claude-3-5-sonnet',
          temperature: 0.3,
        },
      });

      // Get preferences
      const response = await server.inject({
        method: 'GET',
        url: '/prefs/ai',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.default_model).toBe('anthropic/claude-3-5-sonnet');
      expect(body.temperature).toBe(0.3);
    });
  });

  describe('PUT /prefs/ai', () => {
    it('should update preferences', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          default_model: 'anthropic/claude-3-5-sonnet',
          temperature: 0.5,
          max_tokens: 2000,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.default_model).toBe('anthropic/claude-3-5-sonnet');
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2000);
    });

    it('should update task-specific models', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          task_models: {
            tagging: 'openai/gpt-4-turbo',
            linking: 'anthropic/claude-3-5-sonnet',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.task_models).toHaveProperty('tagging', 'openai/gpt-4-turbo');
      expect(body.task_models).toHaveProperty('linking', 'anthropic/claude-3-5-sonnet');
    });

    it('should merge preferences (PATCH-like behavior)', async () => {
      // Set initial preferences
      await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          default_model: 'model-a',
          temperature: 0.2,
          task_models: {
            tagging: 'model-b',
          },
        },
      });

      // Update only temperature
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          temperature: 0.5,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.default_model).toBe('model-a'); // Preserved
      expect(body.temperature).toBe(0.5); // Updated
      expect(body.task_models.tagging).toBe('model-b'); // Preserved
    });

    it('should reject invalid temperature', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          temperature: 3.0, // Out of range (max 2.0)
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
    });

    it('should reject invalid max_tokens', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/ai',
        payload: {
          max_tokens: -100, // Negative
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
    });
  });
});
