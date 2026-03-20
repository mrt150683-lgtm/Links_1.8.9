/**
 * Calendar API Routes (029_calendar)
 *
 * POST   /calendar/events                     Create manual event
 * GET    /calendar/events/:id                 Get event by ID
 * PATCH  /calendar/events/:id                 Update event (partial)
 * DELETE /calendar/events/:id                 Delete event
 * GET    /calendar/range?from=&to=            Range query (events + counts)
 * GET    /calendar/date/:dateKey              Events + entry_dates + history for exact date
 * GET    /calendar/search?q=                  Search events + entry_dates
 * GET    /calendar/notifications?unread=1     List notifications
 * POST   /calendar/notifications/:id/read     Mark notification read
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createCalendarEvent,
  getCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarRange,
  getCalendarDate,
  searchCalendar,
  listUnreadCalendarNotifications,
  markCalendarNotificationRead,
} from '@links/storage';

const CreateEventSchema = z.object({
  title: z.string().min(1).max(500),
  start_at: z.number().int().positive(),
  pot_id: z.string().uuid().optional(),
  details: z.string().max(5000).optional(),
  end_at: z.number().int().positive().optional(),
  all_day: z.boolean().optional().default(false),
  importance: z.number().int().min(0).max(100).optional().default(1),
  timezone: z.string().optional(),
});

const UpdateEventSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  details: z.string().max(5000).optional(),
  start_at: z.number().int().positive().optional(),
  end_at: z.number().int().positive().optional(),
  all_day: z.boolean().optional(),
  importance: z.number().int().min(0).max(100).optional(),
  timezone: z.string().optional(),
});

const RangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pot_id: z.string().uuid().optional(),
  include_extracted: z.coerce.boolean().optional().default(true),
  include_history: z.coerce.boolean().optional().default(true),
});

const SearchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pot_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

function validationError(request: any, reply: any, message: string) {
  return reply.status(400).send({
    error: 'ValidationError',
    message,
    statusCode: 400,
    request_id: request.id,
  });
}

export const calendarRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Events CRUD ──────────────────────────────────────────────────────────

  fastify.post('/calendar/events', async (request, reply) => {
    const parsed = CreateEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }
    const event = await createCalendarEvent(parsed.data);
    return reply.status(201).send(event);
  });

  fastify.get<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params;
    const event = await getCalendarEvent(id);
    if (!event) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Calendar event not found: ${id}`,
        statusCode: 404,
        request_id: request.id,
      });
    }
    return reply.status(200).send(event);
  });

  fastify.patch<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params;
    const parsed = UpdateEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }
    const event = await updateCalendarEvent(id, parsed.data, parsed.data.timezone);
    if (!event) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Calendar event not found: ${id}`,
        statusCode: 404,
        request_id: request.id,
      });
    }
    return reply.status(200).send(event);
  });

  fastify.delete<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = await deleteCalendarEvent(id);
    if (!deleted) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Calendar event not found: ${id}`,
        statusCode: 404,
        request_id: request.id,
      });
    }
    return reply.status(204).send();
  });

  // ── Range Query ──────────────────────────────────────────────────────────

  fastify.get('/calendar/range', async (request, reply) => {
    const parsed = RangeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }
    const { from, to, pot_id } = parsed.data;
    const result = await getCalendarRange(from, to, pot_id);
    return reply.status(200).send(result);
  });

  // ── Date Detail ──────────────────────────────────────────────────────────

  fastify.get<{ Params: { dateKey: string } }>('/calendar/date/:dateKey', async (request, reply) => {
    const { dateKey } = request.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return validationError(request, reply, 'dateKey must be YYYY-MM-DD');
    }
    const pot_id = (request.query as any).pot_id as string | undefined;
    const result = await getCalendarDate(dateKey, pot_id);
    return reply.status(200).send(result);
  });

  // ── Search ───────────────────────────────────────────────────────────────

  fastify.get('/calendar/search', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }
    const result = await searchCalendar(parsed.data);
    return reply.status(200).send(result);
  });

  // ── Notifications ────────────────────────────────────────────────────────

  fastify.get('/calendar/notifications', async (request, reply) => {
    const notifications = await listUnreadCalendarNotifications();
    return reply.status(200).send({ notifications });
  });

  fastify.post<{ Params: { id: string } }>('/calendar/notifications/:id/read', async (request, reply) => {
    const { id } = request.params;
    await markCalendarNotificationRead(id);
    return reply.status(200).send({ ok: true });
  });
};
