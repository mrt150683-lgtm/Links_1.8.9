/**
 * Calendar API Integration Tests
 *
 * Tests: POST/GET/PATCH/DELETE /calendar/events,
 *        GET /calendar/range, GET /calendar/date/:dateKey,
 *        GET /calendar/search, GET/POST /calendar/notifications
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unlinkSync } from 'node:fs';
import { createServer } from '../src/server.js';
import { getConfig } from '@links/config';
import { initDatabase, runMigrations, createPot, closeDatabase } from '@links/storage';

const TEST_DB = `./test-api-calendar-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('Calendar API', () => {
  let server: FastifyInstance;
  let potId: string;

  beforeEach(async () => {
    process.env.DATABASE_PATH = TEST_DB;
    const config = getConfig();
    server = await createServer(config);
    await server.ready();

    const pot = await createPot({ name: 'Test Pot' });
    potId = pot.id;
  });

  afterEach(async () => {
    await server.close();
    closeDatabase();
    try { unlinkSync(TEST_DB); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB + '-wal'); } catch { /* ignore */ }
  });

  // ── POST /calendar/events ─────────────────────────────────────────

  describe('POST /calendar/events', () => {
    it('creates a new event and returns 201', async () => {
      const start_at = Date.UTC(2026, 2, 20, 10, 0, 0);
      const res = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { title: 'Test Event', start_at, all_day: false, importance: 50 },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Test Event');
      expect(body.date_key).toBe('2026-03-20');
    });

    it('returns 400 when title is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { start_at: Date.now(), all_day: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when start_at is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { title: 'No start' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /calendar/events/:id ──────────────────────────────────────

  describe('GET /calendar/events/:id', () => {
    it('returns 200 for existing event', async () => {
      const created = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { title: 'Get Test', start_at: Date.UTC(2026, 2, 21, 9, 0, 0), all_day: false, importance: 1 },
      });
      const { id } = created.json();

      const res = await server.inject({ method: 'GET', url: `/calendar/events/${id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Get Test');
    });

    it('returns 404 for unknown id', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/calendar/events/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /calendar/events/:id ────────────────────────────────────

  describe('PATCH /calendar/events/:id', () => {
    it('updates event title and returns updated event', async () => {
      const created = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { title: 'Original', start_at: Date.UTC(2026, 2, 22, 9, 0, 0), all_day: false, importance: 1 },
      });
      const { id } = created.json();

      const res = await server.inject({
        method: 'PATCH',
        url: `/calendar/events/${id}`,
        payload: { title: 'Updated' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Updated');
    });

    it('returns 404 for unknown id', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/calendar/events/00000000-0000-0000-0000-000000000000',
        payload: { title: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /calendar/events/:id ───────────────────────────────────

  describe('DELETE /calendar/events/:id', () => {
    it('deletes event and returns 204', async () => {
      const created = await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: { title: 'To delete', start_at: Date.UTC(2026, 2, 23, 9, 0, 0), all_day: false, importance: 1 },
      });
      const { id } = created.json();

      const del = await server.inject({ method: 'DELETE', url: `/calendar/events/${id}` });
      expect(del.statusCode).toBe(204);

      const get = await server.inject({ method: 'GET', url: `/calendar/events/${id}` });
      expect(get.statusCode).toBe(404);
    });

    it('returns 404 for unknown id', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/calendar/events/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /calendar/range ───────────────────────────────────────────

  describe('GET /calendar/range', () => {
    it('returns events and counts structure', async () => {
      await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: {
          title: 'April event',
          start_at: Date.UTC(2026, 3, 10, 10, 0, 0), // 2026-04-10
          all_day: false,
          importance: 1,
        },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/calendar/range?from=2026-04-01&to=2026-04-30',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.events)).toBe(true);
      expect(typeof body.entry_date_counts).toBe('object');
      expect(typeof body.history_counts).toBe('object');
      expect(body.events.some((e: { title: string }) => e.title === 'April event')).toBe(true);
    });

    it('returns 400 when from or to are missing', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/range?from=2026-04-01' });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when date format is invalid', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/range?from=20260401&to=20260430' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /calendar/date/:dateKey ───────────────────────────────────

  describe('GET /calendar/date/:dateKey', () => {
    it('returns events, entry_dates, history arrays', async () => {
      await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: {
          title: 'May event',
          start_at: Date.UTC(2026, 4, 5, 9, 0, 0), // 2026-05-05
          all_day: false,
          importance: 1,
        },
      });

      const res = await server.inject({ method: 'GET', url: '/calendar/date/2026-05-05' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.events)).toBe(true);
      expect(Array.isArray(body.entry_dates)).toBe(true);
      expect(Array.isArray(body.history)).toBe(true);
      expect(body.events.some((e: { title: string }) => e.title === 'May event')).toBe(true);
    });

    it('returns 400 for malformed date key', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/date/20260505' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /calendar/search ──────────────────────────────────────────

  describe('GET /calendar/search', () => {
    it('finds matching events by title', async () => {
      await server.inject({
        method: 'POST',
        url: '/calendar/events',
        payload: {
          title: 'Quarterly review meeting',
          start_at: Date.UTC(2026, 2, 25, 14, 0, 0),
          all_day: false,
          importance: 100,
        },
      });

      const res = await server.inject({ method: 'GET', url: '/calendar/search?q=quarterly' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.some((e: { title: string }) => e.title.toLowerCase().includes('quarterly'))).toBe(true);
    });

    it('returns 400 when q is missing', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/search' });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when q is too short', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/search?q=x' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /calendar/notifications ───────────────────────────────────

  describe('GET /calendar/notifications', () => {
    it('returns an array (may be empty)', async () => {
      const res = await server.inject({ method: 'GET', url: '/calendar/notifications?unread=1' });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });
  });
});
