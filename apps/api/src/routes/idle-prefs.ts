/**
 * Idle Processing Preferences Routes
 * Phase 5: User preferences for idle-time AI processing
 */

import type { FastifyPluginAsync } from 'fastify';
import { IdleProcessingPreferencesSchema, type IdleProcessingPrefsResponse, RunNowRequestSchema, type RunNowRequest, type RunNowResponse } from '@links/core';
import { getIdlePrefs, setIdlePrefs, setForceRunNow, getPotById } from '@links/storage';

export const idlePrefsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/idle
   * Get idle processing preferences
   */
  fastify.get('/prefs/idle', async (request, reply) => {
    const prefs = await getIdlePrefs();

    const response: IdleProcessingPrefsResponse = {
      enabled: prefs.enabled,
      idle_only: prefs.idle_only,
      run_window_start: prefs.run_window_start,
      run_window_end: prefs.run_window_end,
      pot_ids: prefs.pot_ids,
    };

    return reply.status(200).send(response);
  });

  /**
   * PUT /prefs/idle
   * Update idle processing preferences
   */
  fastify.put<{
    Body: unknown;
  }>('/prefs/idle', async (request, reply) => {
    // Validate request body
    const validation = IdleProcessingPreferencesSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${validation.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const patch = validation.data;

    // Validate that pot_ids reference existing pots
    if (patch.pot_ids && patch.pot_ids.length > 0) {
      for (const potId of patch.pot_ids) {
        const pot = await getPotById(potId);
        if (!pot) {
          return reply.status(404).send({
            error: 'NotFoundError',
            message: `Pot not found: ${potId}`,
            statusCode: 404,
            request_id: request.id,
          });
        }
      }
    }

    // Update preferences
    await setIdlePrefs(patch);

    // Get updated preferences
    const updated = await getIdlePrefs();

    const response: IdleProcessingPrefsResponse = {
      enabled: updated.enabled,
      idle_only: updated.idle_only,
      run_window_start: updated.run_window_start,
      run_window_end: updated.run_window_end,
      pot_ids: updated.pot_ids,
    };

    return reply.status(200).send(response);
  });

  /**
   * POST /prefs/idle/run-now
   * Force worker to run for specified duration (overrides idle policy)
   */
  fastify.post<{
    Body: unknown;
  }>('/prefs/idle/run-now', async (request, reply) => {
    // Validate request body
    const validation = RunNowRequestSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${validation.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { minutes } = validation.data;

    // Set force run override
    const forceRunUntil = await setForceRunNow(minutes);

    const response: RunNowResponse = {
      force_run_until: forceRunUntil,
      minutes,
    };

    request.log.info({
      minutes,
      force_run_until: forceRunUntil,
      msg: 'Force run override activated',
    });

    return reply.status(200).send(response);
  });
};
