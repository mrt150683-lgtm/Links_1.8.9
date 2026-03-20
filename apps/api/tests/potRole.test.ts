/**
 * Integration Tests: Pot Role API (018_pot_role)
 *
 * Tests GET /pots/:id/role and PUT /pots/:id/role endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

const TEST_DB = './test-api-pot-role.db';
// Use a temp dir so ROLES_DIR is isolated
const TEST_ROLES_DIR = './test-api-roles-tmp';

describe('Pot Role API', () => {
  let server: FastifyInstance;
  let potId: string;

  beforeAll(async () => {
    process.env.ROLES_DIR = TEST_ROLES_DIR;

    server = await createServer({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: TEST_DB,
    });

    // Create a test pot
    const res = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Role Test Pot', description: 'For role testing' },
    });
    potId = JSON.parse(res.body).id;
  });

  afterAll(async () => {
    delete process.env.ROLES_DIR;
    await server.close();
    try {
      unlinkSync(TEST_DB);
      unlinkSync(TEST_DB + '-shm');
      unlinkSync(TEST_DB + '-wal');
    } catch {
      // Ignore cleanup errors
    }
    try {
      rmSync(TEST_ROLES_DIR, { recursive: true, force: true });
      rmSync(join(TEST_ROLES_DIR, '..', 'userData'), { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('GET /pots/:id/role', () => {
    it('returns 404 for non-existent pot', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/pots/non-existent-id/role',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns default role for a new pot with no role set', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/role`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.source).toBe('default');
      expect(body.role_ref).toBeNull();
      expect(body.text).toBeTruthy();
      expect(typeof body.hash).toBe('string');
      expect(body.hash.length).toBe(64); // SHA-256 hex
      expect(Array.isArray(body.lint_warnings)).toBe(true);
    });
  });

  describe('PUT /pots/:id/role', () => {
    it('returns 404 for non-existent pot', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: '/pots/non-existent-id/role',
        payload: { text: 'Some role text' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when text exceeds 12000 characters', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/pots/${potId}/role`,
        payload: { text: 'x'.repeat(12001) },
      });
      expect(res.statusCode).toBe(400);
    });

    it('saves a user role and returns updated data', async () => {
      const roleText = '# Role\n\nYou are a test analyst.\n\n## Goals\n\nTest.\n\n## Do\n\nPass tests.\n\n## Don\'t\n\nFail tests.';
      const res = await server.inject({
        method: 'PUT',
        url: `/pots/${potId}/role`,
        payload: { text: roleText },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.source).toBe('user');
      expect(body.role_ref).toBe('user:');
      expect(body.text).toBe(roleText);
      expect(typeof body.hash).toBe('string');
      expect(body.hash.length).toBe(64);
    });

    it('GET after PUT returns the saved role', async () => {
      const roleText = '# Role\n\nUpdated role.\n\n## Goals\n\nVerify round-trip.\n\n## Do\n\nReturn correct text.\n\n## Don\'t\n\nLose data.';
      await server.inject({
        method: 'PUT',
        url: `/pots/${potId}/role`,
        payload: { text: roleText },
      });

      const getRes = await server.inject({
        method: 'GET',
        url: `/pots/${potId}/role`,
      });
      expect(getRes.statusCode).toBe(200);
      const body = JSON.parse(getRes.body);
      expect(body.source).toBe('user');
      expect(body.text).toBe(roleText.trim()); // canonicalised
    });

    it('different roles produce different hashes', async () => {
      const roleA = '# Role\n\nRole A text.\n\n## Goals\n\nGoal A.\n\n## Do\n\nDo A.\n\n## Don\'t\n\nDon\'t A.';
      const roleB = '# Role\n\nRole B text.\n\n## Goals\n\nGoal B.\n\n## Do\n\nDo B.\n\n## Don\'t\n\nDon\'t B.';

      const resA = await server.inject({
        method: 'PUT',
        url: `/pots/${potId}/role`,
        payload: { text: roleA },
      });
      const resB = await server.inject({
        method: 'PUT',
        url: `/pots/${potId}/role`,
        payload: { text: roleB },
      });

      const hashA = JSON.parse(resA.body).hash;
      const hashB = JSON.parse(resB.body).hash;
      expect(hashA).not.toBe(hashB);
    });
  });
});
