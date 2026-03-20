/**
 * Phase 12: Search Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';

describe('Search', () => {
  let server: FastifyInstance;
  let potId: string;

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0, host: '127.0.0.1' });

    // Create a test pot
    const potResponse = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Search Test Pot' },
    });
    potId = JSON.parse(potResponse.body).id;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Full-text search', () => {
    it('should create entries for searching', async () => {
      // Create multiple entries with different content
      const texts = [
        'The quick brown fox jumps over the lazy dog',
        'Alice in Wonderland is a classic novel',
        'JavaScript is a versatile programming language',
        'TypeScript adds type safety to JavaScript',
        'Rust is a systems programming language',
      ];

      for (const text of texts) {
        const response = await server.inject({
          method: 'POST',
          url: `/pots/${potId}/entries/text`,
          payload: {
            text,
            capture_method: 'manual',
          },
        });
        expect(response.statusCode).toBe(201);
      }
    });

    it('should find entries by keyword', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=JavaScript`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.q).toBe('JavaScript');
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThanOrEqual(body.results.length);
    });

    it('should find entries by partial word', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=program`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.results.length).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      const response1 = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=a&limit=2&offset=0`,
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.limit).toBe(2);
      expect(body1.offset).toBe(0);
      expect(body1.results.length).toBeLessThanOrEqual(2);

      const response2 = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=a&limit=2&offset=2`,
      });

      const body2 = JSON.parse(response2.body);
      expect(body2.offset).toBe(2);
    });

    it('should enforce max limit', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=a&limit=200`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.limit).toBeLessThanOrEqual(100);
    });

    it('should filter by entry type', async () => {
      // Create a link entry
      const linkResponse = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/entries/link`,
        payload: {
          link_url: 'https://example.com/javascript',
          link_title: 'JavaScript Tutorial',
          capture_method: 'manual',
        },
      });
      expect(linkResponse.statusCode).toBe(201);

      // Search for "JavaScript" type link only
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=JavaScript&type=link`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.results.forEach((result: any) => {
        expect(result.type).toBe('link');
      });
    });

    it('should return empty results for no match', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=xyzabc123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.results.length).toBe(0);
      expect(body.total).toBe(0);
    });

    it('should reject empty query', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it('should include snippet in results', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=JavaScript`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.results.length > 0) {
        const result = body.results[0];
        expect(result.snippet).toBeDefined();
        expect(result.snippet.length).toBeGreaterThan(0);
      }
    });

    it('should include metadata in results', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=quick`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.results.length > 0) {
        const result = body.results[0];
        expect(result.entry_id).toBeDefined();
        expect(result.type).toBeDefined();
        expect(result.score).toBeDefined();
        expect(result.captured_at).toBeDefined();
      }
    });
  });

  describe('Search performance', () => {
    it('should handle large result sets', async () => {
      // Create many entries (simplified test)
      // In production, would want to test with 2k+ entries
      const response = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/search?q=a&limit=100`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.results.length).toBeLessThanOrEqual(100);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });
  });
});
