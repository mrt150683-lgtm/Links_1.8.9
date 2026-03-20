/**
 * Research Notifications API Routes
 *
 * GET  /research/notifications       - List notifications for a pot
 * POST /research/notifications/:id/read - Mark a notification as read
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listResearchNotifications,
  markResearchNotificationRead,
} from '@links/storage';

const ListQuerySchema = z.object({
  pot_id: z.string().uuid(),
  unread_only: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const NotificationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const researchNotificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /research/notifications - List notifications
  fastify.get('/research/notifications', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const notifications = await listResearchNotifications(query.pot_id, {
      unread_only: query.unread_only,
      limit: query.limit,
    });
    return reply.status(200).send({ notifications });
  });

  // POST /research/notifications/:id/read - Mark as read
  fastify.post<{ Params: { id: string } }>('/research/notifications/:id/read', async (request, reply) => {
    const { id } = NotificationIdParamSchema.parse(request.params);
    await markResearchNotificationRead(id);
    return reply.status(200).send({ ok: true });
  });
};
