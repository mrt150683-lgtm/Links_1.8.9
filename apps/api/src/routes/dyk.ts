/**
 * DYK API Routes (030_dyk)
 *
 * GET  /pots/:potId/dyk                  — list DYK items for a pot
 * GET  /dyk/:dykId                       — single DYK item
 * POST /dyk/:dykId/feedback              — submit feedback action
 * GET  /pots/:potId/dyk/inbox            — list dyk_notifications
 * POST /dyk-notifications/:id/read       — mark notification read
 * POST /dyk-notifications/:id/dismiss    — dismiss notification
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listDykItems,
  getDykItem,
  updateDykItemStatus,
  insertDykFeedbackEvent,
  listDykNotifications,
  updateDykNotificationStatus,
  getDykNotification,
  logAuditEvent,
} from '@links/storage';
import { DykFeedbackRequestSchema, DykListQuerySchema } from '@links/core';

function validationError(request: any, reply: any, message: string) {
  return reply.status(400).send({
    error: 'ValidationError',
    message,
    statusCode: 400,
    request_id: request.id,
  });
}

export const dykRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List DYK items ──────────────────────────────────────────────────────────

  fastify.get('/pots/:potId/dyk', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const parsed = DykListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }

    const items = await listDykItems(potId, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      min_confidence: parsed.data.min_confidence,
      min_novelty: parsed.data.min_novelty,
    });

    return reply.send({ items, total: items.length });
  });

  // ── Get single DYK item ─────────────────────────────────────────────────────

  fastify.get('/dyk/:dykId', async (request, reply) => {
    const { dykId } = request.params as { dykId: string };
    const item = await getDykItem(dykId);
    if (!item) {
      return reply.status(404).send({ error: 'NotFound', message: 'DYK item not found', statusCode: 404 });
    }
    return reply.send(item);
  });

  // ── Feedback ────────────────────────────────────────────────────────────────

  fastify.post('/dyk/:dykId/feedback', async (request, reply) => {
    const { dykId } = request.params as { dykId: string };

    const parsed = DykFeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }

    const item = await getDykItem(dykId);
    if (!item) {
      return reply.status(404).send({ error: 'NotFound', message: 'DYK item not found', statusCode: 404 });
    }

    const { action, snooze_hours, engine_id } = parsed.data;

    // Map action to new status
    let newStatus: Parameters<typeof updateDykItemStatus>[1] | null = null;
    let nextEligibleAt: number | undefined;

    switch (action) {
      case 'known':
        newStatus = 'known';
        break;
      case 'interested':
        newStatus = 'interested';
        break;
      case 'useless':
        newStatus = 'useless';
        break;
      case 'snooze':
        newStatus = 'snoozed';
        nextEligibleAt = Date.now() + (snooze_hours ?? 24) * 3_600_000;
        break;
      case 'opened_chat':
      case 'opened_search':
        // No status change, just log feedback
        break;
    }

    if (newStatus) {
      await updateDykItemStatus(dykId, newStatus, nextEligibleAt);
    }

    // Always record feedback event
    await insertDykFeedbackEvent({
      dyk_id: dykId,
      pot_id: item.pot_id,
      action,
      snooze_hours: snooze_hours,
      engine_id: engine_id,
    });

    // Audit log
    await logAuditEvent({
      actor: 'user',
      action: 'dyk_feedback',
      pot_id: item.pot_id,
      entry_id: item.entry_id,
      metadata: { dyk_id: dykId, action, snooze_hours },
    });

    return reply.send({ ok: true });
  });

  // ── DYK Inbox (notifications) ───────────────────────────────────────────────

  const InboxQuerySchema = z.object({
    unread_only: z.coerce.boolean().optional().default(true),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  fastify.get('/pots/:potId/dyk/inbox', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const parsed = InboxQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }

    const notifications = await listDykNotifications(potId, {
      unread_only: parsed.data.unread_only,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return reply.send({ notifications, total: notifications.length });
  });

  // ── Mark notification read ──────────────────────────────────────────────────

  fastify.post('/dyk-notifications/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    const notif = await getDykNotification(id);
    if (!notif) {
      return reply.status(404).send({ error: 'NotFound', message: 'Notification not found', statusCode: 404 });
    }
    await updateDykNotificationStatus(id, 'read');
    return reply.send({ ok: true });
  });

  // ── Dismiss notification ────────────────────────────────────────────────────

  fastify.post('/dyk-notifications/:id/dismiss', async (request, reply) => {
    const { id } = request.params as { id: string };
    const notif = await getDykNotification(id);
    if (!notif) {
      return reply.status(404).send({ error: 'NotFound', message: 'Notification not found', statusCode: 404 });
    }
    await updateDykNotificationStatus(id, 'dismissed');
    return reply.send({ ok: true });
  });
};
