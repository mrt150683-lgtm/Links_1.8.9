import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { closeDatabase } from '@links/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Preferences API', () => {
  let server: FastifyInstance;
  const testDbPath = path.join(process.cwd(), 'test-prefs.db');

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

  describe('GET /prefs/capture', () => {
    it('should return empty object initially', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/prefs/capture',
      });

      expect(response.statusCode).toBe(200);
      const prefs = JSON.parse(response.body);
      expect(prefs).toEqual({});
    });
  });

  describe('PUT /prefs/capture', () => {
    it('should set default_pot_id', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Default Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Set default_pot_id
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          default_pot_id: pot.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const prefs = JSON.parse(response.body);
      expect(prefs.default_pot_id).toBe(pot.id);
    });

    it('should set autosave preferences', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Autosave Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Enable autosave globally
      const response1 = await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          autosave: {
            enabled: true,
          },
        },
      });

      expect(response1.statusCode).toBe(200);
      const prefs1 = JSON.parse(response1.body);
      expect(prefs1.autosave?.enabled).toBe(true);

      // Set pot-specific override
      const response2 = await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          autosave: {
            enabled: true,
            pot_overrides: {
              [pot.id]: false,
            },
          },
        },
      });

      expect(response2.statusCode).toBe(200);
      const prefs2 = JSON.parse(response2.body);
      expect(prefs2.autosave?.enabled).toBe(true);
      expect(prefs2.autosave?.pot_overrides?.[pot.id]).toBe(false);
    });

    it('should merge autosave.pot_overrides (PATCH-like)', async () => {
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

      // Set override for pot1
      await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          autosave: {
            enabled: true,
            pot_overrides: {
              [pot1.id]: false,
            },
          },
        },
      });

      // Set override for pot2 (should merge, not replace)
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          autosave: {
            enabled: true,
            pot_overrides: {
              [pot2.id]: true,
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const prefs = JSON.parse(response.body);
      expect(prefs.autosave?.pot_overrides?.[pot1.id]).toBe(false);
      expect(prefs.autosave?.pot_overrides?.[pot2.id]).toBe(true);
    });

    it('should reject non-existent pot_id', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          default_pot_id: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('Pot not found');
    });

    it('should return updated values after PUT', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Last Used Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Set last_pot_id
      await server.inject({
        method: 'PUT',
        url: '/prefs/capture',
        payload: {
          last_pot_id: pot.id,
        },
      });

      // Get preferences
      const response = await server.inject({
        method: 'GET',
        url: '/prefs/capture',
      });

      expect(response.statusCode).toBe(200);
      const prefs = JSON.parse(response.body);
      expect(prefs.last_pot_id).toBe(pot.id);
    });
  });
});
