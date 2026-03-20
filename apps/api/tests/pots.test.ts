import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

const TEST_DB = './test-api-pots.db';

describe('Pots API', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: TEST_DB,
    });
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

  describe('POST /pots', () => {
    it('should create a pot with name and description', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: {
          name: 'Test Pot',
          description: 'A test research pot',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Pot');
      expect(body.description).toBe('A test research pot');
      expect(body.security_level).toBe('standard');
      expect(body.created_at).toBeTypeOf('number');
      expect(body.updated_at).toBe(body.created_at);
    });

    it('should create a pot with only name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: {
          name: 'Minimal Pot',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.name).toBe('Minimal Pot');
      expect(body.description).toBeNull();
    });

    it('should reject invalid request (missing name)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: {
          description: 'No name',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /pots', () => {
    it('should list all pots', async () => {
      // Create a few pots first
      await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Pot 1' },
      });

      await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Pot 2' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/pots',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.pots).toBeInstanceOf(Array);
      expect(body.pots.length).toBeGreaterThanOrEqual(2);
      expect(body.total).toBeGreaterThanOrEqual(2);
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots?limit=1&offset=0',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.pots.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /pots/:id', () => {
    it('should get a pot by ID', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Get Test' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'GET',
        url: `/pots/${created.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Get Test');
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /pots/:id', () => {
    it('should update pot name', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Original Name' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'PATCH',
        url: `/pots/${created.id}`,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.name).toBe('Updated Name');
      expect(body.updated_at).toBeGreaterThan(created.updated_at);
    });

    it('should update pot description', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Test' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'PATCH',
        url: `/pots/${created.id}`,
        payload: { description: 'New description' },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.description).toBe('New description');
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/pots/00000000-0000-0000-0000-000000000000',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /pots/:id', () => {
    it('should delete a pot', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'To Delete' },
      });

      const created = JSON.parse(createResponse.body);

      const response = await server.inject({
        method: 'DELETE',
        url: `/pots/${created.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const getResponse = await server.inject({
        method: 'GET',
        url: `/pots/${created.id}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 for non-existent pot', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/pots/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
