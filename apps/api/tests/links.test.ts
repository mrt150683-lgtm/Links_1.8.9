/**
 * Phase 8: Link Discovery Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import { getConfig } from '@links/config';
import { closeDatabase } from '@links/storage';
import type { FastifyInstance } from 'fastify';

describe('Phase 8: Link Discovery', () => {
  let server: FastifyInstance;
  let potId: string;
  let entry1Id: string;
  let entry2Id: string;
  let entry3Id: string;

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    closeDatabase();
  });

  describe('Setup: Create test data', () => {
    it('should create a pot', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: {
          name: 'Phase 8 Test Pot',
          description: 'Testing link discovery',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      potId = body.id;
      expect(potId).toBeTruthy();
    });

    it('should create entry 1 with shared entities', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/entries`,
        payload: {
          content: 'Dr. Jane Smith published groundbreaking research on machine learning algorithms at Stanford University. The study examined neural network architectures for natural language processing.',
          capture_method: 'test',
          captured_at: Date.now(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      entry1Id = body.id;
      expect(entry1Id).toBeTruthy();
    });

    it('should create entry 2 with overlapping content', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/entries`,
        payload: {
          content: 'Jane Smith\'s team at Stanford developed innovative techniques for training large language models. Their machine learning approach showed significant improvements in accuracy.',
          capture_method: 'test',
          captured_at: Date.now(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      entry2Id = body.id;
      expect(entry2Id).toBeTruthy();
    });

    it('should create entry 3 on unrelated topic', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/entries`,
        payload: {
          content: 'Climate change impacts are accelerating faster than predicted. Scientists warn of tipping points in Arctic ice melt and ocean circulation patterns.',
          capture_method: 'test',
          captured_at: Date.now(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      entry3Id = body.id;
      expect(entry3Id).toBeTruthy();
    });

    it('should process entries with Phase 7 artifacts', async () => {
      // Process entry 1
      let response = await server.inject({
        method: 'POST',
        url: `/entries/${entry1Id}/process`,
        payload: {
          types: ['tags', 'entities'],
        },
      });
      expect(response.statusCode).toBe(202);

      // Process entry 2
      response = await server.inject({
        method: 'POST',
        url: `/entries/${entry2Id}/process`,
        payload: {
          types: ['tags', 'entities'],
        },
      });
      expect(response.statusCode).toBe(202);

      // Process entry 3
      response = await server.inject({
        method: 'POST',
        url: `/entries/${entry3Id}/process`,
        payload: {
          types: ['tags', 'entities'],
        },
      });
      expect(response.statusCode).toBe(202);
    });
  });

  describe('Link Discovery', () => {
    it('should trigger link discovery for entry 1', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/entries/${entry1Id}/link-discovery`,
        payload: {
          max_candidates: 30,
          force: true,
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.entry_id).toBe(entry1Id);
      expect(body.jobs_enqueued).toBe(1);
      expect(body.job_id).toBeTruthy();
    });

    it('should reject link discovery for non-existent entry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/entries/non-existent-id/link-discovery',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('should validate trigger request body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/entries/${entry1Id}/link-discovery`,
        payload: {
          max_candidates: -1, // Invalid
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Link Queries', () => {
    it('should list links for entry (initially empty)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entry_id).toBe(entry1Id);
      expect(body.links).toBeInstanceOf(Array);
      // Links array may be empty if worker hasn't processed yet
    });

    it('should list links for pot', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/links`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pot_id).toBe(potId);
      expect(body.links).toBeInstanceOf(Array);
      expect(body.total_count).toBeGreaterThanOrEqual(0);
    });

    it('should filter links by confidence threshold', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links?min_confidence=0.8`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // All returned links should have confidence >= 0.8
      for (const link of body.links) {
        expect(link.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should filter links by type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links?type=same_entity`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // All returned links should be same_entity type
      for (const link of body.links) {
        expect(link.link_type).toBe('same_entity');
      }
    });

    it('should count links for entry', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links/count`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entry_id).toBe(entry1Id);
      expect(body.count).toBeGreaterThanOrEqual(0);
      expect(body.min_confidence).toBe(0.6);
    });

    it('should reject queries for non-existent entry', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/entries/non-existent-id/links',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject queries for non-existent pot', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots/non-existent-id/links',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should validate query parameters', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links?min_confidence=invalid`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Link Response Format', () => {
    it('should include required fields in link response', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/links?min_confidence=0`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.links.length > 0) {
        const link = body.links[0];
        expect(link).toHaveProperty('id');
        expect(link).toHaveProperty('src_entry_id');
        expect(link).toHaveProperty('dst_entry_id');
        expect(link).toHaveProperty('link_type');
        expect(link).toHaveProperty('confidence');
        expect(link).toHaveProperty('rationale');
        expect(link).toHaveProperty('evidence');
        expect(link).toHaveProperty('created_at');
        expect(link.evidence).toBeInstanceOf(Array);
      }
    });

    it('should format entry links with other_entry_id', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/entries/${entry1Id}/links?min_confidence=0`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.links.length > 0) {
        const link = body.links[0];
        expect(link).toHaveProperty('link_id');
        expect(link).toHaveProperty('link_type');
        expect(link).toHaveProperty('other_entry_id');
        expect(link).toHaveProperty('evidence');
        // other_entry_id should not be the queried entry
        expect(link.other_entry_id).not.toBe(entry1Id);
      }
    });
  });
});
