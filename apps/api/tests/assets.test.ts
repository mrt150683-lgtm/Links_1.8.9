/**
 * Phase 4: Asset API integration tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { closeDatabase, assetExists } from '@links/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import FormData from 'form-data';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Assets API', () => {
  let server: FastifyInstance;
  const testDbPath = path.join(process.cwd(), 'test-assets.db');
  const testAssetsDir = path.join(process.cwd(), 'test-assets-data');
  const testImagePath = path.join(__dirname, 'fixtures', 'test-image.png');
  const testPdfPath = path.join(__dirname, 'fixtures', 'test-document.pdf');

  beforeAll(async () => {
    // Clean up any existing test database and assets
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testAssetsDir)) {
      fs.rmSync(testAssetsDir, { recursive: true, force: true });
    }

    const config = getConfig();
    config.DATABASE_PATH = testDbPath;
    config.ASSETS_DIR = testAssetsDir;
    server = await createServer(config);
  });

  afterAll(async () => {
    await server.close();
    closeDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testAssetsDir)) {
      fs.rmSync(testAssetsDir, { recursive: true, force: true });
    }
  });

  describe('POST /pots/:potId/assets', () => {
    it('should upload asset successfully', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Test Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload image
      const imageBuffer = fs.readFileSync(testImagePath);
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'test.png',
        contentType: 'image/png',
      });

      const uploadResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form,
        headers: form.getHeaders(),
      });

      expect(uploadResponse.statusCode).toBe(201);
      const result = JSON.parse(uploadResponse.body);
      expect(result.created).toBe(true);
      expect(result.deduped).toBe(false);
      expect(result.asset).toMatchObject({
        id: expect.any(String),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        size_bytes: expect.any(Number),
        mime_type: 'image/png',
        original_filename: 'test.png',
        storage_path: expect.any(String),
        encryption_version: 1,
        created_at: expect.any(Number),
      });

      // Verify blob file exists
      const blobExists = await assetExists(result.asset.storage_path);
      expect(blobExists).toBe(true);
    });

    it('should dedupe on second upload of same file', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Dedupe Test Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Use a unique buffer so prior tests can't interfere
      const uniqueBuffer = Buffer.from(`dedupe-test-${Date.now()}-${Math.random()}`);

      // First upload
      const form1 = new FormData();
      form1.append('file', uniqueBuffer, {
        filename: 'file1.bin',
        contentType: 'application/octet-stream',
      });

      const upload1Response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form1,
        headers: form1.getHeaders(),
      });
      const result1 = JSON.parse(upload1Response.body);
      expect(result1.created).toBe(true);
      const asset1Id = result1.asset.id;

      // Second upload (same content, different filename)
      const form2 = new FormData();
      form2.append('file', uniqueBuffer, {
        filename: 'file2.bin',
        contentType: 'application/octet-stream',
      });

      const upload2Response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form2,
        headers: form2.getHeaders(),
      });

      expect(upload2Response.statusCode).toBe(200);
      const result2 = JSON.parse(upload2Response.body);
      expect(result2.created).toBe(false);
      expect(result2.deduped).toBe(true);
      expect(result2.asset.id).toBe(asset1Id); // Same asset returned
    });

    it('should reject non-multipart request', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Empty Upload Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Send JSON instead of multipart
      const response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: {},
      });

      // @fastify/multipart returns 406 for non-multipart content-type
      expect(response.statusCode).toBe(406);
    });

    it('should reject non-existent pot', async () => {
      const form = new FormData();
      form.append('file', Buffer.from('test'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/pots/00000000-0000-0000-0000-000000000000/assets',
        payload: form,
        headers: form.getHeaders(),
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('NotFoundError');
    });
  });

  describe('POST /pots/:potId/entries/image', () => {
    it('should create image entry successfully', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Image Entry Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload image
      const imageBuffer = fs.readFileSync(testImagePath);
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'photo.png',
        contentType: 'image/png',
      });

      const uploadResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form,
        headers: form.getHeaders(),
      });
      const uploadResult = JSON.parse(uploadResponse.body);

      // Create image entry
      const entryResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/image`,
        payload: {
          asset_id: uploadResult.asset.id,
          capture_method: 'screenshot',
          captured_at: Date.now(),
        },
      });

      expect(entryResponse.statusCode).toBe(201);
      const entry = JSON.parse(entryResponse.body);
      expect(entry).toMatchObject({
        id: expect.any(String),
        pot_id: pot.id,
        type: 'image',
        asset_id: uploadResult.asset.id,
        capture_method: 'screenshot',
        content_text: null, // Asset-backed entries have no text content
        content_sha256: null,
      });

      // Verify asset is embedded
      expect(entry.asset).toMatchObject({
        id: uploadResult.asset.id,
        sha256: uploadResult.asset.sha256,
        mime_type: 'image/png',
      });
    });

    it('should reject non-existent asset_id', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Invalid Asset Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      const response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/image`,
        payload: {
          asset_id: '00000000-0000-0000-0000-000000000000',
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('NotFoundError');
    });

    it('should reject missing asset_id', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Missing Asset ID Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      const response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/image`,
        payload: {
          capture_method: 'test',
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.error).toBe('ValidationError');
    });
  });

  describe('POST /pots/:potId/entries/doc', () => {
    it('should create doc entry successfully', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Doc Entry Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload PDF
      const pdfBuffer = fs.readFileSync(testPdfPath);
      const form = new FormData();
      form.append('file', pdfBuffer, {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      });

      const uploadResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form,
        headers: form.getHeaders(),
      });
      const uploadResult = JSON.parse(uploadResponse.body);

      // Create doc entry
      const entryResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/doc`,
        payload: {
          asset_id: uploadResult.asset.id,
          capture_method: 'upload',
          source_url: 'https://example.com/doc',
          notes: 'Important document',
        },
      });

      expect(entryResponse.statusCode).toBe(201);
      const entry = JSON.parse(entryResponse.body);
      expect(entry).toMatchObject({
        type: 'doc',
        asset_id: uploadResult.asset.id,
        capture_method: 'upload',
        source_url: 'https://example.com/doc',
        notes: 'Important document',
      });

      // Verify asset is embedded
      expect(entry.asset).toMatchObject({
        id: uploadResult.asset.id,
        mime_type: 'application/pdf',
        original_filename: 'document.pdf',
      });
    });
  });

  describe('GET /entries/:entryId', () => {
    it('should return entry with embedded asset metadata', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Get Entry Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload a unique file to avoid dedupe contamination from other tests
      const uniqueBuffer = Buffer.from(`get-entry-test-${Date.now()}-${Math.random()}`);
      const form = new FormData();
      form.append('file', uniqueBuffer, {
        filename: 'embedded.bin',
        contentType: 'application/octet-stream',
      });

      const uploadResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form,
        headers: form.getHeaders(),
      });
      const uploadResult = JSON.parse(uploadResponse.body);
      expect(uploadResult.created).toBe(true);

      const entryResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/image`,
        payload: {
          asset_id: uploadResult.asset.id,
          capture_method: 'test',
        },
      });
      const entry = JSON.parse(entryResponse.body);

      // Fetch entry by ID
      const fetchResponse = await server.inject({
        method: 'GET',
        url: `/entries/${entry.id}`,
      });

      expect(fetchResponse.statusCode).toBe(200);
      const fetchedEntry = JSON.parse(fetchResponse.body);
      expect(fetchedEntry.id).toBe(entry.id);
      expect(fetchedEntry.asset).toMatchObject({
        id: uploadResult.asset.id,
        sha256: uploadResult.asset.sha256,
        size_bytes: expect.any(Number),
        mime_type: 'application/octet-stream',
        original_filename: 'embedded.bin',
      });
    });
  });

  describe('GET /pots/:potId/assets', () => {
    it('should list all assets for pot', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'List Assets Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload two different assets
      const imageBuffer = fs.readFileSync(testImagePath);
      const pdfBuffer = fs.readFileSync(testPdfPath);

      // Upload image
      const form1 = new FormData();
      form1.append('file', imageBuffer, {
        filename: 'image.png',
        contentType: 'image/png',
      });
      const upload1Response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form1,
        headers: form1.getHeaders(),
      });
      const asset1 = JSON.parse(upload1Response.body).asset;

      // Create image entry
      await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/image`,
        payload: {
          asset_id: asset1.id,
          capture_method: 'test',
        },
      });

      // Upload PDF
      const form2 = new FormData();
      form2.append('file', pdfBuffer, {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
      const upload2Response = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form2,
        headers: form2.getHeaders(),
      });
      const asset2 = JSON.parse(upload2Response.body).asset;

      // Create doc entry
      await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/entries/doc`,
        payload: {
          asset_id: asset2.id,
          capture_method: 'test',
        },
      });

      // List assets
      const listResponse = await server.inject({
        method: 'GET',
        url: `/pots/${pot.id}/assets`,
      });

      expect(listResponse.statusCode).toBe(200);
      const result = JSON.parse(listResponse.body);
      expect(result.pot_id).toBe(pot.id);
      expect(result.assets).toHaveLength(2);

      const assetIds = result.assets.map((a: any) => a.id);
      expect(assetIds).toContain(asset1.id);
      expect(assetIds).toContain(asset2.id);
    });

    it('should return empty list for pot with no assets', async () => {
      // Create pot without assets
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Empty Assets Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      const listResponse = await server.inject({
        method: 'GET',
        url: `/pots/${pot.id}/assets`,
      });

      expect(listResponse.statusCode).toBe(200);
      const result = JSON.parse(listResponse.body);
      expect(result.assets).toHaveLength(0);
    });
  });

  describe('Encryption verification', () => {
    it('should store encrypted blobs (not plaintext)', async () => {
      // Create pot
      const potResponse = await server.inject({
        method: 'POST',
        url: '/pots',
        payload: { name: 'Encryption Test Pot' },
      });
      const pot = JSON.parse(potResponse.body);

      // Upload image with known content
      const imageBuffer = fs.readFileSync(testImagePath);
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'encrypt-test.png',
        contentType: 'image/png',
      });

      const uploadResponse = await server.inject({
        method: 'POST',
        url: `/pots/${pot.id}/assets`,
        payload: form,
        headers: form.getHeaders(),
      });
      const result = JSON.parse(uploadResponse.body);

      // Read blob file
      const blobPath = path.join(testAssetsDir, result.asset.storage_path);
      const blobBuffer = fs.readFileSync(blobPath);

      // Verify blob is NOT plaintext (encrypted blobs won't match PNG signature)
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const blobStart = blobBuffer.subarray(0, 4);
      expect(blobStart.equals(pngSignature)).toBe(false); // Should be encrypted, not PNG

      // Verify blob is larger than original (encryption overhead ~29 bytes)
      expect(blobBuffer.length).toBeGreaterThan(imageBuffer.length);
      expect(blobBuffer.length).toBeLessThan(imageBuffer.length + 100); // Reasonable overhead
    });
  });
});
