/**
 * Browser routes — Phase B+
 *
 * REST endpoints for browser persistence (shelf, groups, sessions, history).
 * All endpoints are local-only (API binds to 127.0.0.1).
 *
 * Prefix: /browser
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getShelf,
  addToShelf,
  removeFromShelf,
  clearShelf,
  listTabGroups,
  createTabGroup,
  updateTabGroup,
  deleteTabGroup,
  listSessions,
  saveSession,
  getSession,
  deleteSession,
  searchHistory,
  recordHistoryVisit,
  clearHistory,
  deleteHistoryEntry,
  getHistoryEntry,
  getHistoryStats,
} from '@links/storage';
import {
  AddToShelfBodySchema,
  CreateTabGroupBodySchema,
  UpdateTabGroupBodySchema,
  SaveSessionBodySchema,
  RecordHistoryBodySchema,
  PromoteHistoryBodySchema,
} from '@links/core';
import { getDatabase } from '@links/storage';

export async function browserRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Shelf ───────────────────────────────────────────────────────────────

  fastify.get('/browser/shelf', async (_req, reply) => {
    const items = await getShelf();
    return reply.send({ items });
  });

  fastify.post('/browser/shelf', async (req: FastifyRequest, reply) => {
    const body = AddToShelfBodySchema.parse(req.body);
    const item = await addToShelf({
      id: body.id,
      url: body.url,
      title: body.title,
      faviconUrl: body.faviconUrl,
      groupId: body.groupId,
      note: body.note,
      shelvedAt: body.shelvedAt,
      lastActiveAt: body.lastActiveAt,
    });
    return reply.status(201).send({ item });
  });

  fastify.delete('/browser/shelf', async (_req, reply) => {
    await clearShelf();
    return reply.send({ ok: true });
  });

  fastify.delete('/browser/shelf/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await removeFromShelf(req.params.id);
    return reply.send({ ok: true });
  });

  // ── Tab Groups ─────────────────────────────────────────────────────────

  fastify.get('/browser/groups', async (_req, reply) => {
    const groups = await listTabGroups();
    return reply.send({ groups });
  });

  fastify.post('/browser/groups', async (req: FastifyRequest, reply) => {
    const body = CreateTabGroupBodySchema.parse(req.body);
    const group = await createTabGroup({
      id: body.id,
      name: body.name,
      color: body.color,
      potId: body.potId,
    });
    return reply.status(201).send({ group });
  });

  fastify.patch(
    '/browser/groups/:id',
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply,
    ) => {
      const body = UpdateTabGroupBodySchema.parse(req.body);
      await updateTabGroup(req.params.id, {
        name: body.name,
        color: body.color,
        potId: body.potId === undefined ? undefined : body.potId,
      });
      return reply.send({ ok: true });
    },
  );

  fastify.delete(
    '/browser/groups/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      await deleteTabGroup(req.params.id);
      return reply.send({ ok: true });
    },
  );

  // ── Sessions ────────────────────────────────────────────────────────────

  fastify.get('/browser/sessions', async (_req, reply) => {
    const sessions = await listSessions();
    return reply.send({ sessions });
  });

  fastify.post('/browser/sessions', async (req: FastifyRequest, reply) => {
    const body = SaveSessionBodySchema.parse(req.body);
    const session = await saveSession({
      id: body.id,
      name: body.name,
      tabSnapshot: body.tabSnapshot,
      shelfSnapshot: body.shelfSnapshot,
      groupsSnapshot: body.groupsSnapshot,
    });
    return reply.status(201).send({ session });
  });

  fastify.get(
    '/browser/sessions/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await getSession(req.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      return reply.send(session);
    },
  );

  fastify.delete(
    '/browser/sessions/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      await deleteSession(req.params.id);
      return reply.send({ ok: true });
    },
  );

  // ── History ─────────────────────────────────────────────────────────────

  fastify.get(
    '/browser/history',
    async (
      req: FastifyRequest<{ Querystring: { q?: string; limit?: string } }>,
      reply,
    ) => {
      const { q, limit } = req.query;
      const entries = await searchHistory(q, limit ? parseInt(limit, 10) : 100);
      return reply.send({ entries });
    },
  );

  fastify.post('/browser/history', async (req: FastifyRequest, reply) => {
    const body = RecordHistoryBodySchema.parse(req.body);
    const entry = await recordHistoryVisit({
      id: body.id,
      url: body.url,
      title: body.title,
      tabId: body.tabId,
      visitTime: body.visitTime,
    });
    return reply.status(201).send({ entry });
  });

  fastify.delete('/browser/history', async (_req, reply) => {
    await clearHistory();
    return reply.send({ ok: true });
  });

  fastify.delete(
    '/browser/history/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      await deleteHistoryEntry(req.params.id);
      return reply.send({ ok: true });
    },
  );

  /**
   * Promote a history entry to a Links pot entry (Phase K).
   * Creates a link-type entry in the specified pot.
   */
  fastify.post(
    '/browser/history/:id/promote',
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply,
    ) => {
      const histEntry = await getHistoryEntry(req.params.id);
      if (!histEntry) return reply.status(404).send({ error: 'History entry not found' });

      const body = PromoteHistoryBodySchema.parse(req.body);

      // Create a link entry in the specified pot
      const db = getDatabase();
      const { randomUUID } = await import('node:crypto');
      const entryId = randomUUID();
      const now = Date.now();

      await db.insertInto('entries').values({
        id: entryId,
        pot_id: body.pot_id,
        type: 'link',
        content_text: histEntry.title ?? histEntry.url,
        content_sha256: '',
        capture_method: 'browser_history',
        source_url: histEntry.url,
        source_title: histEntry.title ?? null,
        notes: body.notes ?? null,
        captured_at: histEntry.visitTime * 1000,
        created_at: now,
        updated_at: now,
        client_capture_id: null,
        source_app: 'links-browser',
        source_context_json: null,
        asset_id: null,
        link_url: histEntry.url,
        link_title: histEntry.title ?? null,
      }).execute();

      return reply.status(201).send({ entry_id: entryId });
    },
  );

  // ── Browser stats (for diagnostics) ──────────────────────────────────

  fastify.get('/browser/stats', async (_req, reply) => {
    const shelf = await getShelf();
    const groups = await listTabGroups();
    const sessions = await listSessions();
    const histStats = await getHistoryStats();
    return reply.send({
      shelved_tabs: shelf.length,
      groups: groups.length,
      sessions_saved: sessions.length,
      history_entries: histStats.totalEntries,
      captures_today: histStats.todayCount,
    });
  });
}
