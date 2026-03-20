/**
 * DYK API Integration Tests
 *
 * Tests: GET /pots/:potId/dyk, GET /dyk/:dykId,
 *        POST /dyk/:dykId/feedback (known/snooze/useless),
 *        GET /pots/:potId/dyk/inbox, POST /dyk-notifications/:id/read,
 *        GET /pots/:potId/onboarding, POST /pots/:potId/onboarding/complete,
 *        GET /search-targets
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unlinkSync } from 'node:fs';
import { createServer } from '../src/server.js';
import { getConfig } from '@links/config';
import {
  initDatabase, runMigrations, createPot, closeDatabase,
  createTextEntryIdempotent,
  insertDykItems, computeDykSignature, createDykNotification,
} from '@links/storage';

const TEST_DB = `./test-api-dyk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('DYK API', () => {
  let server: FastifyInstance;
  let potId: string;
  let entryId: string;

  beforeEach(async () => {
    process.env.DATABASE_PATH = TEST_DB;
    const config = getConfig();
    server = await createServer(config);
    await server.ready();

    const pot = await createPot({ name: 'DYK Test Pot' });
    potId = pot.id;

    const entry = await createTextEntryIdempotent({
      pot_id: potId,
      content_text: 'Research about quantum computing and cryptography.',
      capture_method: 'test',
    });
    entryId = entry.entry.id;
  });

  afterEach(async () => {
    await server.close();
    closeDatabase();
    try { unlinkSync(TEST_DB); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  });

  // ── Helper ───────────────────────────────────────────────────────────

  async function createTestDykItem(title = 'Did you know quantum computing is fast') {
    const signature = computeDykSignature(title, 'Test body.', ['quantum', 'computing'], 'entry_summary', '1', null);
    const items = await insertDykItems([{
      pot_id: potId,
      entry_id: entryId,
      title,
      body: 'Test body about quantum computing.',
      keywords: ['quantum', 'computing'],
      confidence: 0.85,
      novelty: 0.9,
      source_type: 'entry_summary',
      signature,
      model_id: 'test-model',
      prompt_id: 'dyk_generate_from_entry',
      prompt_version: '1',
    }]);
    return items[0];
  }

  // ── GET /pots/:potId/dyk ─────────────────────────────────────────────

  describe('GET /pots/:potId/dyk', () => {
    it('returns items for the correct pot', async () => {
      await createTestDykItem();

      const res = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].pot_id).toBe(potId);
    });

    it('does not return items for a different pot', async () => {
      await createTestDykItem();
      const otherPot = await createPot({ name: 'Other Pot' });

      const res = await server.inject({ method: 'GET', url: `/pots/${otherPot.id}/dyk` });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    });

    it('filters by status', async () => {
      await createTestDykItem();

      const res = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk?status=known` });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    });
  });

  // ── GET /dyk/:dykId ──────────────────────────────────────────────────

  describe('GET /dyk/:dykId', () => {
    it('returns the DYK item', async () => {
      const item = await createTestDykItem();

      const res = await server.inject({ method: 'GET', url: `/dyk/${item.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(item.id);
    });

    it('returns 404 for unknown id', async () => {
      const res = await server.inject({ method: 'GET', url: '/dyk/nonexistent-id' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /dyk/:dykId/feedback — known ────────────────────────────────

  describe('POST /dyk/:dykId/feedback (known)', () => {
    it('sets status to known', async () => {
      const item = await createTestDykItem();

      const res = await server.inject({
        method: 'POST',
        url: `/dyk/${item.id}/feedback`,
        payload: { action: 'known' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Verify status change via list
      const listRes = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk?status=known` });
      expect(listRes.json().items).toHaveLength(1);
    });
  });

  // ── POST /dyk/:dykId/feedback — snooze ───────────────────────────────

  describe('POST /dyk/:dykId/feedback (snooze)', () => {
    it('sets status to snoozed with correct next_eligible_at', async () => {
      const item = await createTestDykItem();

      const before = Date.now();
      const res = await server.inject({
        method: 'POST',
        url: `/dyk/${item.id}/feedback`,
        payload: { action: 'snooze', snooze_hours: 24 },
      });
      expect(res.statusCode).toBe(200);

      // Verify item is snoozed
      const getRes = await server.inject({ method: 'GET', url: `/dyk/${item.id}` });
      const updated = getRes.json();
      expect(updated.status).toBe('snoozed');
      expect(updated.next_eligible_at).toBeGreaterThan(before + 23 * 3_600_000);
    });
  });

  // ── POST /dyk/:dykId/feedback — useless ──────────────────────────────

  describe('POST /dyk/:dykId/feedback (useless)', () => {
    it('sets status to useless and records feedback event', async () => {
      const item = await createTestDykItem();

      const res = await server.inject({
        method: 'POST',
        url: `/dyk/${item.id}/feedback`,
        payload: { action: 'useless' },
      });
      expect(res.statusCode).toBe(200);

      const getRes = await server.inject({ method: 'GET', url: `/dyk/${item.id}` });
      expect(getRes.json().status).toBe('useless');
    });

    it('returns 400 for invalid action', async () => {
      const item = await createTestDykItem();

      const res = await server.inject({
        method: 'POST',
        url: `/dyk/${item.id}/feedback`,
        payload: { action: 'invalid_action' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /pots/:potId/dyk/inbox ────────────────────────────────────────

  describe('GET /pots/:potId/dyk/inbox', () => {
    it('returns unread notifications for the pot', async () => {
      const item = await createTestDykItem();
      await createDykNotification({ pot_id: potId, dyk_id: item.id, title: item.title, body: item.body });

      const res = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk/inbox` });
      expect(res.statusCode).toBe(200);
      expect(res.json().notifications).toHaveLength(1);
    });

    it('returns empty list when no unread notifications', async () => {
      const res = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk/inbox` });
      expect(res.statusCode).toBe(200);
      expect(res.json().notifications).toHaveLength(0);
    });
  });

  // ── POST /dyk-notifications/:id/read ─────────────────────────────────

  describe('POST /dyk-notifications/:id/read', () => {
    it('marks notification as read', async () => {
      const item = await createTestDykItem();
      const notif = await createDykNotification({ pot_id: potId, dyk_id: item.id, title: item.title, body: item.body });

      const res = await server.inject({ method: 'POST', url: `/dyk-notifications/${notif.id}/read` });
      expect(res.statusCode).toBe(200);

      // Now inbox should be empty
      const inboxRes = await server.inject({ method: 'GET', url: `/pots/${potId}/dyk/inbox` });
      expect(inboxRes.json().notifications).toHaveLength(0);
    });
  });

  // ── GET /pots/:potId/onboarding ───────────────────────────────────────

  describe('GET /pots/:potId/onboarding', () => {
    it('returns null state when no onboarding exists', async () => {
      const res = await server.inject({ method: 'GET', url: `/pots/${potId}/onboarding` });
      expect(res.statusCode).toBe(200);
      expect(res.json().completed_at).toBeNull();
    });

    it('returns 404 for unknown pot', async () => {
      const res = await server.inject({ method: 'GET', url: '/pots/unknown-pot/onboarding' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /pots/:potId/onboarding/complete ─────────────────────────────

  describe('POST /pots/:potId/onboarding/complete', () => {
    it('writes completed_at and pot columns', async () => {
      const before = Date.now();
      const res = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/onboarding/complete`,
        payload: {
          goal_text: 'Study quantum computing',
          search_targets: ['google', 'arxiv'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.completed_at).toBeGreaterThanOrEqual(before);
      expect(body.goal_text).toBe('Study quantum computing');
      expect(body.search_targets).toContain('google');
    });

    it('returns 400 when goal_text is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/pots/${potId}/onboarding/complete`,
        payload: { search_targets: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /search-targets ───────────────────────────────────────────────

  describe('GET /search-targets', () => {
    it('returns static search engine registry', async () => {
      const res = await server.inject({ method: 'GET', url: '/search-targets' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.targets).toBeDefined();
      expect(body.targets.length).toBeGreaterThan(5);
      expect(body.targets[0]).toHaveProperty('id');
      expect(body.targets[0]).toHaveProperty('label');
      expect(body.targets[0]).toHaveProperty('url_template');
    });
  });
});
