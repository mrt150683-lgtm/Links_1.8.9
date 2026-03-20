/**
 * Main Chat Notifications API Routes
 *
 * GET    /main-chat/notifications              - List active notifications
 * GET    /main-chat/notifications/unread-count - Count unread
 * POST   /main-chat/notifications              - Create a notification
 * POST   /main-chat/notifications/:id/open     - Mark as opened
 * POST   /main-chat/notifications/:id/dismiss  - Mark as dismissed
 * POST   /main-chat/notifications/:id/snooze   - Snooze for N hours
 * DELETE /main-chat/notifications/:id          - Hard delete
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listMainChatNotifications,
  countUnreadMainChatNotifications,
  updateMainChatNotificationState,
  deleteMainChatNotification,
  createMainChatNotification,
  expireSnoozedMainChatNotifications,
} from '@links/storage';

const NotificationIdSchema = z.object({ id: z.string().uuid() });

const SnoozeBodySchema = z.object({
  hours: z.number().int().min(1).max(168).default(24),
});

const CreateNotificationSchema = z.object({
  type: z.enum(['greeting', 'triage', 'insight', 'goal_aligned', 'reminder', 'system']),
  title: z.string().min(1).max(200),
  preview: z.string().max(500).optional(),
  payload: z.record(z.unknown()).optional(),
});

export const mainChatNotificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /main-chat/notifications - List active (unread + opened) notifications
  fastify.get('/main-chat/notifications', async (request, reply) => {
    // Expire any snoozed notifications whose time has passed
    await expireSnoozedMainChatNotifications().catch(() => { /* non-fatal */ });
    const notifications = await listMainChatNotifications({ states: ['unread', 'opened'] });
    return reply.status(200).send({ notifications });
  });

  // GET /main-chat/notifications/unread-count - Get count of unread notifications
  fastify.get('/main-chat/notifications/unread-count', async (_request, reply) => {
    await expireSnoozedMainChatNotifications().catch(() => { /* non-fatal */ });
    const count = await countUnreadMainChatNotifications();
    return reply.status(200).send({ count });
  });

  // POST /main-chat/notifications - Create a notification (for proactive generators / testing)
  fastify.post('/main-chat/notifications', async (request, reply) => {
    const body = CreateNotificationSchema.parse(request.body);
    const notification = await createMainChatNotification(body);
    return reply.status(201).send({ notification });
  });

  // POST /main-chat/notifications/:id/open - Mark as opened
  fastify.post<{ Params: { id: string } }>('/main-chat/notifications/:id/open', async (request, reply) => {
    const { id } = NotificationIdSchema.parse(request.params);
    await updateMainChatNotificationState(id, 'opened');
    return reply.status(200).send({ ok: true });
  });

  // POST /main-chat/notifications/:id/dismiss - Mark as dismissed
  fastify.post<{ Params: { id: string } }>('/main-chat/notifications/:id/dismiss', async (request, reply) => {
    const { id } = NotificationIdSchema.parse(request.params);
    await updateMainChatNotificationState(id, 'dismissed');
    return reply.status(200).send({ ok: true });
  });

  // POST /main-chat/notifications/:id/snooze - Snooze for N hours
  fastify.post<{ Params: { id: string } }>('/main-chat/notifications/:id/snooze', async (request, reply) => {
    const { id } = NotificationIdSchema.parse(request.params);
    const body = SnoozeBodySchema.parse(request.body);
    const snoozed_until = Date.now() + body.hours * 60 * 60 * 1000;
    await updateMainChatNotificationState(id, 'snoozed', snoozed_until);
    return reply.status(200).send({ ok: true });
  });

  // DELETE /main-chat/notifications/:id - Hard delete
  fastify.delete<{ Params: { id: string } }>('/main-chat/notifications/:id', async (request, reply) => {
    const { id } = NotificationIdSchema.parse(request.params);
    await deleteMainChatNotification(id);
    return reply.status(204).send();
  });
};
