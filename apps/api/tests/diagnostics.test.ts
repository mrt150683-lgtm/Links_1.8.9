/**
 * Phase 12: Diagnostics Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';

describe('Diagnostics', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /health', () => {
    it('should return expanded health status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Validate schema
      expect(body.ok).toBeDefined();
      expect(typeof body.ok).toBe('boolean');
      expect(body.service).toBe('api');
      expect(body.version).toBe('0.1.0');
      expect(typeof body.time).toBe('number');

      // Database status
      expect(body.database).toBeDefined();
      expect(typeof body.database.connected).toBe('boolean');
      expect(typeof body.database.migration_version).toBe('number');

      // Model registry status
      expect(body.model_registry).toBeDefined();
      expect(body.model_registry.fetched_at).toBeDefined();
      expect(body.model_registry.age_hours).toBeDefined();
    });

    it('should report database connected', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.database.connected).toBe(true);
      expect(body.database.migration_version).toBeGreaterThan(0);
    });

    it('should include worker status if available', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Worker is optional (undefined if not running)
      if (body.worker) {
        expect(body.worker.last_heartbeat).toBeDefined();
        expect(body.worker.status).toMatch(/^(running|idle|stopped|unknown)$/);
      }
    });
  });

  describe('GET /diagnostics', () => {
    it('should return detailed diagnostics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Database diagnostics
      expect(body.database).toBeDefined();
      expect(typeof body.database.path).toBe('string');
      expect(typeof body.database.wal_mode).toBe('boolean');
      expect(typeof body.database.synchronous).toBe('string');
      expect(typeof body.database.migration_version).toBe('number');

      // Job queue diagnostics
      expect(body.job_queue).toBeDefined();
      expect(typeof body.job_queue.queued).toBe('number');
      expect(typeof body.job_queue.running).toBe('number');
      expect(typeof body.job_queue.failed).toBe('number');
      expect(typeof body.job_queue.dead).toBe('number');

      // Asset store diagnostics
      expect(body.asset_store).toBeDefined();
      expect(typeof body.asset_store.blob_count).toBe('number');
      expect(typeof body.asset_store.orphan_count).toBe('number');

      // Model registry diagnostics
      expect(body.model_registry).toBeDefined();
      expect(body.model_registry.fetched_at).toBeDefined();
      expect(body.model_registry.age_ms).toBeDefined();
      expect(typeof body.model_registry.model_count).toBe('number');
    });

    it('should report WAL mode enabled', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.database.wal_mode).toBe(true);
    });

    it('should report non-negative counts', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // All counts should be non-negative
      expect(body.job_queue.queued).toBeGreaterThanOrEqual(0);
      expect(body.job_queue.running).toBeGreaterThanOrEqual(0);
      expect(body.job_queue.failed).toBeGreaterThanOrEqual(0);
      expect(body.job_queue.dead).toBeGreaterThanOrEqual(0);
      expect(body.asset_store.blob_count).toBeGreaterThanOrEqual(0);
      expect(body.asset_store.orphan_count).toBeGreaterThanOrEqual(0);
      expect(body.model_registry.model_count).toBeGreaterThanOrEqual(0);
    });

    it('should include database file path', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.database.path).toBeTruthy();
      expect(body.database.path.length).toBeGreaterThan(0);
    });

    it('should report current migration version', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should be at least migration 5 (Phase 12 search migration)
      expect(body.database.migration_version).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Diagnostics consistency', () => {
    it('health and diagnostics should report same migration version', async () => {
      const healthResponse = await server.inject({
        method: 'GET',
        url: '/health',
      });
      const diagResponse = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(diagResponse.statusCode).toBe(200);

      const healthBody = JSON.parse(healthResponse.body);
      const diagBody = JSON.parse(diagResponse.body);

      expect(healthBody.database.migration_version).toBe(
        diagBody.database.migration_version
      );
    });

    it('orphan count should not exceed blob count', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/diagnostics',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.asset_store.orphan_count).toBeLessThanOrEqual(
        body.asset_store.blob_count
      );
    });
  });
});
