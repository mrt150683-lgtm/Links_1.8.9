/**
 * Journal Module: API Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';
import { unlinkSync } from 'node:fs';
import { initDatabase, runMigrations, upsertJournalEntry, closeDatabase } from '@links/storage';

const TEST_DB_PATH = `./test-api-journal-${Date.now()}-${Math.random().toString(36).substring(7)}.db`;

describe('Journal API', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    const config = getConfig();
    server = await createServer(config);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    try { unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB_PATH + '-shm'); } catch { /* ignore */ }
    try { unlinkSync(TEST_DB_PATH + '-wal'); } catch { /* ignore */ }
  });

  // -------------------------------------------------------------------------
  // GET /journal/daily
  // -------------------------------------------------------------------------

  describe('GET /journal/daily', () => {
    it('returns 404 when no daily note exists', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/daily?date=2026-01-01&scope=global',
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when date is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/daily?scope=global',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when date is malformed', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/daily?date=20260101&scope=global',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when scope=pot but pot_id missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/daily?date=2026-02-17&scope=pot',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 200 with content when daily note exists', async () => {
      // Insert a journal note directly
      await upsertJournalEntry({
        kind: 'daily',
        scope_type: 'global',
        period_start_ymd: '2026-02-17',
        period_end_ymd: '2026-02-17',
        timezone: 'UTC',
        model_id: 'test/model',
        prompt_id: 'journal_daily_v1',
        prompt_version: '1',
        temperature: 0.2,
        input_fingerprint: 'test-fp-1',
        content: { schema_version: 1, headline: 'Test headline' },
        citations: [],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/journal/daily?date=2026-02-17&scope=global',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.kind).toBe('daily');
      expect(body.period_start_ymd).toBe('2026-02-17');
      expect(body.content.headline).toBe('Test headline');
    });
  });

  // -------------------------------------------------------------------------
  // GET /journal/weekly
  // -------------------------------------------------------------------------

  describe('GET /journal/weekly', () => {
    it('returns 400 when end is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/weekly?scope=global',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when no weekly note exists', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/journal/weekly?end=2026-02-16&scope=global',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /journal/rebuild
  // -------------------------------------------------------------------------

  describe('POST /journal/rebuild', () => {
    it('returns 202 with job_id for valid daily rebuild', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/journal/rebuild',
        payload: {
          kind: 'daily',
          scope_type: 'global',
          period_start_ymd: '2026-02-17',
          date_ymd: '2026-02-17',
          timezone: 'UTC',
        },
      });
      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.job_id).toBeDefined();
      expect(body.job_type).toBe('build_daily_journal_note');
    });

    it('returns 400 for invalid rebuild body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/journal/rebuild',
        payload: {
          kind: 'invalid_kind',
          scope_type: 'global',
          period_start_ymd: '2026-02-17',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 202 with job_id for weekly rebuild', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/journal/rebuild',
        payload: {
          kind: 'weekly',
          scope_type: 'global',
          period_start_ymd: '2026-02-10',
          period_end_ymd: '2026-02-16',
          timezone: 'UTC',
        },
      });
      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.job_type).toBe('build_weekly_journal_summary');
    });
  });

  // -------------------------------------------------------------------------
  // GET /prefs/processing
  // -------------------------------------------------------------------------

  describe('GET /prefs/processing', () => {
    it('returns default processing config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/prefs/processing',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('journal');
      expect(body.journal).toHaveProperty('enabled');
      // Default is off
      expect(body.journal.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /prefs/processing/journal
  // -------------------------------------------------------------------------

  describe('PATCH /prefs/processing/journal', () => {
    it('returns 400 for invalid patch body', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/prefs/processing/journal',
        payload: { enabled: 'not-a-boolean' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('saves journal config and returns updated config', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/prefs/processing/journal',
        payload: { enabled: true, scopes: { global: true, pots: false } },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.journal.enabled).toBe(true);
      expect(body.journal.scopes?.pots).toBe(false);

      // Verify persisted
      const check = await server.inject({ method: 'GET', url: '/prefs/processing' });
      const checkBody = JSON.parse(check.body);
      expect(checkBody.journal.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/daily
  // -------------------------------------------------------------------------

  describe('GET /pots/:potId/journal/daily', () => {
    it('returns 404 when no entry for pot', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots/pot-nonexistent/journal/daily?date=2026-02-17',
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when date missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/pots/pot-abc/journal/daily',
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
