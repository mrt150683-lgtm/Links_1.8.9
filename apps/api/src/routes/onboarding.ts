/**
 * Onboarding API Routes (030_dyk)
 *
 * GET  /pots/:potId/onboarding              — get onboarding state
 * POST /pots/:potId/onboarding/complete     — complete onboarding wizard
 * PUT  /pots/:potId/settings               — update pot settings (goal, role, search targets, DYK interval)
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  getPotById,
  getOnboarding,
  upsertOnboarding,
  completeOnboarding,
  logAuditEvent,
  setPotDykState,
  getPotDykState,
} from '@links/storage';
import { OnboardingCompleteRequestSchema, PotSettingsUpdateSchema } from '@links/core';

function validationError(request: any, reply: any, message: string) {
  return reply.status(400).send({
    error: 'ValidationError',
    message,
    statusCode: 400,
    request_id: request.id,
  });
}

export const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Get onboarding state ────────────────────────────────────────────────────

  fastify.get('/pots/:potId/onboarding', async (request, reply) => {
    const { potId } = request.params as { potId: string };

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({ error: 'NotFound', message: 'Pot not found', statusCode: 404 });
    }

    const onboarding = await getOnboarding(potId);
    const dykState = await getPotDykState(potId);

    if (!onboarding) {
      // Return a null-state object so UI can check completed_at === null
      return reply.send({
        pot_id: potId,
        completed_at: null,
        goal_text: null,
        role_ref: null,
        search_targets: [],
        state: {},
        dyk_interval_hours: dykState.interval_hours,
      });
    }

    return reply.send({ ...onboarding, dyk_interval_hours: dykState.interval_hours });
  });

  // ── Save intermediate wizard state ─────────────────────────────────────────

  fastify.post('/pots/:potId/onboarding', async (request, reply) => {
    const { potId } = request.params as { potId: string };

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({ error: 'NotFound', message: 'Pot not found', statusCode: 404 });
    }

    const body = request.body as { state?: Record<string, unknown> };
    if (!body.state || typeof body.state !== 'object') {
      return reply.status(400).send({ error: 'ValidationError', message: 'state is required', statusCode: 400 });
    }

    const result = await upsertOnboarding(potId, { state: body.state });
    return reply.send(result);
  });

  // ── Complete onboarding wizard ──────────────────────────────────────────────

  fastify.post('/pots/:potId/onboarding/complete', async (request, reply) => {
    const { potId } = request.params as { potId: string };

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({ error: 'NotFound', message: 'Pot not found', statusCode: 404 });
    }

    const parsed = OnboardingCompleteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }

    const onboarding = await completeOnboarding(potId, {
      goal_text: parsed.data.goal_text,
      role_ref: parsed.data.role_ref,
      search_targets: parsed.data.search_targets,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'pot_onboarding_completed',
      pot_id: potId,
      metadata: { pot_id: potId },
    }).catch(() => { /* non-critical, don't fail the request */ });

    return reply.send(onboarding);
  });

  // ── Update pot settings ─────────────────────────────────────────────────────

  fastify.put('/pots/:potId/settings', async (request, reply) => {
    const { potId } = request.params as { potId: string };

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({ error: 'NotFound', message: 'Pot not found', statusCode: 404 });
    }

    const parsed = PotSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(request, reply, parsed.error.message);
    }

    const { goal_text, role_ref, search_targets, dyk_interval_hours } = parsed.data;

    // Update onboarding record with any provided fields
    if (goal_text != null || role_ref !== undefined || search_targets != null) {
      await upsertOnboarding(potId, {
        goal_text: goal_text,
        role_ref: role_ref === null ? undefined : role_ref,
        search_targets,
      });
    }

    // Update DYK interval if provided
    if (dyk_interval_hours != null) {
      const currentState = await getPotDykState(potId);
      await setPotDykState(potId, {
        next_dyk_due_at: currentState.next_dyk_due_at,
        interval_hours: dyk_interval_hours,
      });
    }

    return reply.send({ ok: true });
  });
};
