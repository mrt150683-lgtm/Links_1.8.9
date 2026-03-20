/**
 * Research Schedules API Routes
 *
 * GET    /research/schedules/:potId  - Get schedule for a pot
 * PUT    /research/schedules/:potId  - Create or update schedule for a pot
 * DELETE /research/schedules/:potId  - Delete schedule for a pot
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getResearchSchedule,
  upsertResearchSchedule,
  deleteResearchSchedule,
  logAuditEvent,
} from '@links/storage';

const PotIdParamSchema = z.object({
  potId: z.string().uuid(),
});

const UpsertScheduleBodySchema = z.object({
  goal_prompt: z.string().min(1).max(5000),
  cron_like: z.string().optional(),
  timezone: z.string().optional().default('UTC'),
  auto_approve_plan: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional(),
});

export const researchSchedulesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /research/schedules/:potId - Get schedule for a pot
  fastify.get<{ Params: { potId: string } }>('/research/schedules/:potId', async (request, reply) => {
    const { potId } = PotIdParamSchema.parse(request.params);
    const schedule = await getResearchSchedule(potId);
    if (!schedule) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'No research schedule found for this pot',
        statusCode: 404,
        request_id: request.id,
      });
    }
    return reply.status(200).send({ schedule });
  });

  // PUT /research/schedules/:potId - Create or update schedule
  fastify.put<{ Params: { potId: string } }>('/research/schedules/:potId', async (request, reply) => {
    const { potId } = PotIdParamSchema.parse(request.params);
    const body = UpsertScheduleBodySchema.parse(request.body);

    const schedule = await upsertResearchSchedule({
      pot_id: potId,
      goal_prompt: body.goal_prompt,
      cron_like: body.cron_like,
      timezone: body.timezone,
      auto_approve_plan: body.auto_approve_plan,
      enabled: body.enabled,
      config: body.config,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'research_schedule_upserted',
      pot_id: potId,
      metadata: { schedule_id: schedule.id, cron_like: body.cron_like },
    });

    return reply.status(200).send({ schedule });
  });

  // DELETE /research/schedules/:potId - Delete schedule
  fastify.delete<{ Params: { potId: string } }>('/research/schedules/:potId', async (request, reply) => {
    const { potId } = PotIdParamSchema.parse(request.params);

    const schedule = await getResearchSchedule(potId);
    if (!schedule) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'No research schedule found for this pot',
        statusCode: 404,
        request_id: request.id,
      });
    }

    await deleteResearchSchedule(schedule.id);

    await logAuditEvent({
      actor: 'user',
      action: 'research_schedule_deleted',
      pot_id: potId,
      metadata: { schedule_id: schedule.id },
    });

    return reply.status(200).send({ ok: true });
  });
};
