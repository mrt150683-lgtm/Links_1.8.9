/**
 * Phase 12: Asset Admin Integration Tests
 *
 * Tests for asset verification and orphan cleanup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Asset Admin', () => {
  let server: FastifyInstance;
  let potId: string;

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0, host: '127.0.0.1' });

    // Create test pot
    const potResponse = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Asset Admin Test Pot' },
    });
    potId = JSON.parse(potResponse.body).id;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /assets/verify', () => {
    it('should verify all assets successfully', async () => {
      // Verify assets (may be 0 if no assets exist yet)
      const verifyResponse = await server.inject({
        method: 'POST',
        url: '/assets/verify',
      });
      expect(verifyResponse.statusCode).toBe(200);

      const result = JSON.parse(verifyResponse.body);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.verified).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.missing)).toBe(true);
      expect(Array.isArray(result.corrupted)).toBe(true);
    });

    it('should return verification structure', async () => {
      const verifyResponse = await server.inject({
        method: 'POST',
        url: '/assets/verify',
      });
      expect(verifyResponse.statusCode).toBe(200);

      const result = JSON.parse(verifyResponse.body);
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('verified');
      expect(result).toHaveProperty('missing');
      expect(result).toHaveProperty('corrupted');
      expect(typeof result.total).toBe('number');
      expect(typeof result.verified).toBe('number');
      expect(Array.isArray(result.missing)).toBe(true);
      expect(Array.isArray(result.corrupted)).toBe(true);
    });
  });

  describe('POST /assets/cleanup-orphans', () => {
    it('should find orphaned assets (dry run)', async () => {
      // Cleanup with dry_run=true (default)
      const cleanupResponse = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: true },
      });
      expect(cleanupResponse.statusCode).toBe(200);

      const result = JSON.parse(cleanupResponse.body);
      expect(result.dry_run).toBe(true);
      expect(result.orphans_found).toBeGreaterThanOrEqual(0);
      expect(result.orphans_deleted).toBe(0); // Dry run doesn't delete
      expect(Array.isArray(result.orphan_ids)).toBe(true);
    });

    it('should delete orphaned assets (dry_run=false)', async () => {
      // First check how many orphans exist
      const cleanupDryResponse = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: true },
      });
      const dryResult = JSON.parse(cleanupDryResponse.body);
      const initialOrphans = dryResult.orphans_found;

      // Cleanup with dry_run=false
      const cleanupResponse = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: false },
      });
      expect(cleanupResponse.statusCode).toBe(200);

      const result = JSON.parse(cleanupResponse.body);
      expect(result.dry_run).toBe(false);
      expect(result.orphans_deleted).toBe(initialOrphans);

      // Verify no more orphans
      const verifyResponse = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: true },
      });
      const verifyResult = JSON.parse(verifyResponse.body);
      expect(verifyResult.orphans_found).toBe(0);
    });

    it('should respect dry_run parameter structure', async () => {
      const response1 = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: true },
      });
      const result1 = JSON.parse(response1.body);
      expect(result1.dry_run).toBe(true);

      const response2 = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: { dry_run: false },
      });
      const result2 = JSON.parse(response2.body);
      expect(result2.dry_run).toBe(false);
    });

    it('should default to dry_run=true when not specified', async () => {
      const cleanupResponse = await server.inject({
        method: 'POST',
        url: '/assets/cleanup-orphans',
        payload: {}, // No dry_run specified
      });
      expect(cleanupResponse.statusCode).toBe(200);

      const result = JSON.parse(cleanupResponse.body);
      expect(result.dry_run).toBe(true);
      expect(result.orphans_deleted).toBe(0);
    });
  });
});
