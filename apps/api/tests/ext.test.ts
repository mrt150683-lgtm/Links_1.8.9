/**
 * Phase 11: Extension Bridge Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { getSqliteInstance } from '@links/storage';
import FormData from 'form-data';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Test Helpers
 */

// Generate unique image fixture per test (prevents asset deduplication across tests)
function createUniqueTestImage(): { path: string; buffer: Buffer; cleanup: () => void } {
  // 1x1 PNG with random RGB values to ensure unique SHA-256
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);

  // Minimal PNG structure with random pixel
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, 0x00, 0x00, 0x00, // bit depth: 8, color type: 2 (RGB)
    0x90, 0x77, 0x53, 0xde, // CRC
    0x00, 0x00, 0x00, 0x0c, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xd7, 0x63, r, g, b, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed RGB data
    0xe2, 0x21, 0xbc, 0x33, // CRC (placeholder)
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82  // CRC
  ]);

  const path = join(tmpdir(), `test-image-${randomUUID()}.png`);
  writeFileSync(path, png);

  return {
    path,
    buffer: png,
    cleanup: () => {
      try {
        unlinkSync(path);
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

// Get unique IP for rate limit isolation
function getUniqueTestIP(counter: number): string {
  return `10.0.${Math.floor(counter / 256)}.${counter % 256}`;
}

describe('Extension Bridge', () => {
  let server: FastifyInstance;
  let potId: string;
  let extToken: string;
  let testCounter = 0; // For unique IPs

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0, host: '127.0.0.1' });

    // Create a test pot
    const potResponse = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Extension Test Pot' },
    });
    potId = JSON.parse(potResponse.body).id;

    // Bootstrap extension token (shared across all tests)
    process.env.EXT_BOOTSTRAP_TOKEN = 'test-bootstrap-secret-123';
    const tokenResponse = await server.inject({
      method: 'POST',
      url: '/ext/auth/bootstrap',
      payload: {
        bootstrap_token: 'test-bootstrap-secret-123',
      },
    });
    extToken = JSON.parse(tokenResponse.body).token;
  });

  afterAll(async () => {
    await server.close();
  });

  // Note: Transaction isolation via savepoints doesn't work well with WAL mode
  // Instead, we use unique test data (unique client_capture_ids, unique images)
  // and token rotation for rate limit isolation

  describe('Token Management', () => {
    it('should bootstrap initial token with EXT_BOOTSTRAP_TOKEN', async () => {
      // Set bootstrap token env var
      process.env.EXT_BOOTSTRAP_TOKEN = 'test-bootstrap-secret-123';

      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/bootstrap',
        payload: {
          bootstrap_token: 'test-bootstrap-secret-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.token).toBeDefined();
      expect(body.token).toHaveLength(64); // 32 bytes hex
      expect(body.created_at).toBeDefined();
      expect(body.last_rotated_at).toBeDefined();
      expect(body.warning).toContain('Save this token');

      // Save token for other tests
      extToken = body.token;
    });

    it('should reject bootstrap with invalid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/bootstrap',
        payload: {
          bootstrap_token: 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Invalid bootstrap token');
    });

    it('should reject bootstrap when EXT_BOOTSTRAP_TOKEN not set', async () => {
      delete process.env.EXT_BOOTSTRAP_TOKEN;

      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/bootstrap',
        payload: {
          bootstrap_token: 'any-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Bootstrap not available');

      // Restore for other tests
      process.env.EXT_BOOTSTRAP_TOKEN = 'test-bootstrap-secret-123';
    });

    it('should rotate token with valid existing token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/rotate',
        headers: {
          Authorization: `Bearer ${extToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.token).toBeDefined();
      expect(body.token).not.toBe(extToken); // Should be new token
      expect(body.token).toHaveLength(64);

      // Update token for other tests
      extToken = body.token;
    });

    it('should reject rotate with invalid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/rotate',
        headers: {
          Authorization: 'Bearer invalid-token-12345',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Invalid extension token');
    });

    it('should reject rotate without token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/auth/rotate',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('token required');
    });
  });

  describe('Selection Capture', () => {
    it('should capture selected text', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: 'This is selected text from the extension',
          capture_method: 'extension_selection',
          source_url: 'https://example.com/article',
          source_title: 'Example Article',
          notes: 'Important research finding',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.created).toBe(true);
      expect(body.entry).toBeDefined();
      expect(body.entry.type).toBe('text');
      expect(body.entry.content_text).toBe('This is selected text from the extension');
      expect(body.entry.capture_method).toBe('extension_selection');
      expect(body.entry.source_url).toBe('https://example.com/article');
      expect(body.deduped).toBe(false);
    });

    it('should deduplicate selection by client_capture_id', async () => {
      const clientCaptureId = `ext-selection-test-${randomUUID()}`;

      // First capture
      const response1 = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: 'Idempotent selection text',
          capture_method: 'extension_selection',
          client_capture_id: clientCaptureId,
        },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.created).toBe(true);
      const entryId = body1.entry.id;

      // Second capture with same client_capture_id
      const response2 = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: 'Different text but same client_capture_id',
          capture_method: 'extension_selection',
          client_capture_id: clientCaptureId,
        },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.created).toBe(false);
      expect(body2.deduped).toBe(true);
      expect(body2.dedupe_reason).toBe('client_capture_id');
      expect(body2.entry.id).toBe(entryId); // Same entry
      expect(body2.entry.content_text).toBe('Idempotent selection text'); // Original text
    });

    it('should reject selection without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: 'Unauthenticated text',
          capture_method: 'extension_selection',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject text exceeding 200k chars', async () => {
      const longText = 'a'.repeat(200_001);

      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: longText,
          capture_method: 'extension_selection',
        },
      });

      expect(response.statusCode).toBe(400); // Validation error
    });
  });

  describe('Page Capture', () => {
    it('should capture current page as link entry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/page',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          link_url: 'https://example.com/research-article',
          link_title: 'Important Research Article',
          content_text: 'This is a brief excerpt from the article...',
          capture_method: 'extension_page',
          notes: 'Key reference for project',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.created).toBe(true);
      expect(body.entry).toBeDefined();
      expect(body.entry.type).toBe('link');
      expect(body.entry.link_url).toBe('https://example.com/research-article');
      expect(body.entry.link_title).toBe('Important Research Article');
      expect(body.entry.content_text).toBe('This is a brief excerpt from the article...');
      expect(body.entry.capture_method).toBe('extension_page');
      expect(body.deduped).toBe(false);
    });

    it('should deduplicate page by client_capture_id', async () => {
      const clientCaptureId = `ext-page-test-${randomUUID()}`;

      // First capture
      const response1 = await server.inject({
        method: 'POST',
        url: '/ext/capture/page',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          link_url: 'https://example.com/idempotent-page',
          link_title: 'Idempotent Page',
          capture_method: 'extension_page',
          client_capture_id: clientCaptureId,
        },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.created).toBe(true);
      const entryId = body1.entry.id;

      // Second capture with same client_capture_id
      const response2 = await server.inject({
        method: 'POST',
        url: '/ext/capture/page',
        headers: {
          Authorization: `Bearer ${extToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          link_url: 'https://example.com/different-page',
          link_title: 'Different Page',
          capture_method: 'extension_page',
          client_capture_id: clientCaptureId,
        },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.created).toBe(false);
      expect(body2.deduped).toBe(true);
      expect(body2.dedupe_reason).toBe('client_capture_id');
      expect(body2.entry.id).toBe(entryId); // Same entry
      expect(body2.entry.link_url).toBe('https://example.com/idempotent-page'); // Original URL
    });

    it('should reject page without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/page',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          link_url: 'https://example.com/page',
          capture_method: 'extension_page',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Image Capture', () => {
    it('should upload and capture image', async () => {
      // Create unique test image (ensures asset_deduped: false)
      const testImage = createUniqueTestImage();

      const form = new FormData();
      form.append('file', testImage.buffer, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      });
      form.append('pot_id', potId);
      form.append('capture_method', 'extension_image');
      form.append('source_url', 'https://example.com/screenshot-page');
      form.append('notes', 'Important screenshot');

      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${extToken}`,
        },
        payload: form,
      });

      testImage.cleanup();

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.created).toBe(true);
      expect(body.entry).toBeDefined();
      expect(body.entry.type).toBe('image');
      expect(body.entry.asset_id).toBeDefined();
      expect(body.entry.capture_method).toBe('extension_image');
      expect(body.asset_deduped).toBe(false); // First upload (unique image)
    });

    it('should deduplicate image by SHA-256', async () => {
      // Upload same image twice
      const testImagePath = join(__dirname, 'fixtures', 'test-image.png');
      const imageBuffer = readFileSync(testImagePath);

      // First upload
      const form1 = new FormData();
      form1.append('file', imageBuffer, {
        filename: 'duplicate-test.png',
        contentType: 'image/png',
      });
      form1.append('pot_id', potId);
      form1.append('capture_method', 'extension_image');

      const response1 = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: {
          ...form1.getHeaders(),
          Authorization: `Bearer ${extToken}`,
        },
        payload: form1,
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      const assetId = body1.entry.asset_id;

      // Second upload (same image)
      const form2 = new FormData();
      form2.append('file', imageBuffer, {
        filename: 'duplicate-test-2.png',
        contentType: 'image/png',
      });
      form2.append('pot_id', potId);
      form2.append('capture_method', 'extension_image');

      const response2 = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: {
          ...form2.getHeaders(),
          Authorization: `Bearer ${extToken}`,
        },
        payload: form2,
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.created).toBe(true); // Entry created
      expect(body2.asset_deduped).toBe(true); // Asset reused
      expect(body2.entry.asset_id).toBe(assetId); // Same asset
    });

    it('should deduplicate image entry by client_capture_id', async () => {
      const clientCaptureId = `ext-image-test-${randomUUID()}`;
      const testImage = createUniqueTestImage();

      // First upload
      const form1 = new FormData();
      form1.append('file', testImage.buffer, {
        filename: 'idempotent-image.png',
        contentType: 'image/png',
      });
      form1.append('pot_id', potId);
      form1.append('capture_method', 'extension_image');
      form1.append('client_capture_id', clientCaptureId);

      const response1 = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: {
          ...form1.getHeaders(),
          Authorization: `Bearer ${extToken}`,
        },
        payload: form1,
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.created).toBe(true);
      const entryId = body1.entry.id;

      // Second upload with same client_capture_id (should dedupe entry, not asset)
      const form2 = new FormData();
      form2.append('file', testImage.buffer, {
        filename: 'different-name.png',
        contentType: 'image/png',
      });
      form2.append('pot_id', potId);
      form2.append('capture_method', 'extension_image');
      form2.append('client_capture_id', clientCaptureId);

      const response2 = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: {
          ...form2.getHeaders(),
          Authorization: `Bearer ${extToken}`,
        },
        payload: form2,
      });

      testImage.cleanup();

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.created).toBe(false);
      expect(body2.deduped).toBe(true);
      expect(body2.dedupe_reason).toBe('client_capture_id');
      expect(body2.entry.id).toBe(entryId); // Same entry
    });

    it('should reject image without authentication', async () => {
      const testImagePath = join(__dirname, 'fixtures', 'test-image.png');
      const imageBuffer = readFileSync(testImagePath);

      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'unauthorized.png',
        contentType: 'image/png',
      });
      form.append('pot_id', potId);

      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/image',
        headers: form.getHeaders(),
        payload: form,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit after 60 requests per minute', async () => {
      // Rotate token to get fresh rate limit bucket (isolates from earlier tests)
      const rotateResponse = await server.inject({
        method: 'POST',
        url: '/ext/auth/rotate',
        headers: {
          Authorization: `Bearer ${extToken}`,
        },
      });
      const freshToken = JSON.parse(rotateResponse.body).token;

      // Make 60 successful requests with fresh token
      for (let i = 0; i < 60; i++) {
        const response = await server.inject({
          method: 'POST',
          url: '/ext/capture/selection',
          headers: {
            Authorization: `Bearer ${freshToken}`,
            'Content-Type': 'application/json',
          },
          payload: {
            pot_id: potId,
            text: `Rate limit test ${i}`,
            capture_method: 'extension_selection',
          },
        });

        expect(response.statusCode).toBe(200);
      }

      // 61st request should be rate limited
      const response = await server.inject({
        method: 'POST',
        url: '/ext/capture/selection',
        headers: {
          Authorization: `Bearer ${freshToken}`,
          'Content-Type': 'application/json',
        },
        payload: {
          pot_id: potId,
          text: 'Rate limit exceeded test',
          capture_method: 'extension_selection',
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Rate limit exceeded');
      expect(body.retry_after_seconds).toBeDefined();
    }, 30000); // Longer timeout for this test
  });
});
