import type { FastifyPluginAsync } from 'fastify';
import { getCapturePrefs, setCapturePrefsPatch, getPotById, getLoggingPrefs, setLoggingPrefs, getOrInitializeExtensionToken } from '@links/storage';
import { CapturePreferencesSchema, LoggingPreferencesSchema } from '@links/core';

/**
 * Phase 3: Preferences endpoints
 */
const prefsRoute: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/capture - Get capture preferences
   */
  fastify.get('/prefs/capture', async (request, reply) => {
    const prefs = await getCapturePrefs();
    return reply.code(200).send(prefs);
  });

  /**
   * PUT /prefs/capture - Update capture preferences (PATCH-like behavior)
   */
  fastify.put<{
    Body: unknown;
  }>('/prefs/capture', async (request, reply) => {
    // Validate request body
    const parseResult = CapturePreferencesSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${parseResult.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const patch = parseResult.data;

    // Validate that referenced pots exist
    const potIdsToCheck: string[] = [];

    if (patch.default_pot_id) {
      potIdsToCheck.push(patch.default_pot_id);
    }

    if (patch.last_pot_id) {
      potIdsToCheck.push(patch.last_pot_id);
    }

    if (patch.autosave?.pot_overrides) {
      potIdsToCheck.push(...Object.keys(patch.autosave.pot_overrides));
    }

    // Check all pot IDs exist
    for (const potId of potIdsToCheck) {
      const pot = await getPotById(potId);
      if (!pot) {
        reply.status(404).send({
          error: 'NotFoundError',
          message: `Pot not found: ${potId}`,
          statusCode: 404,
          request_id: request.id,
        });
        return;
      }
    }

    // Update preferences
    const updatedPrefs = await setCapturePrefsPatch(patch);

    return reply.code(200).send(updatedPrefs);
  });

  /**
   * GET /prefs/logging - Get system logging preferences
   */
  fastify.get('/prefs/logging', async (request, reply) => {
    const prefs = await getLoggingPrefs();
    return reply.code(200).send(prefs);
  });

  /**
   * PUT /prefs/logging - Update system logging preferences
   */
  fastify.put<{
    Body: unknown;
  }>('/prefs/logging', async (request, reply) => {
    const parseResult = LoggingPreferencesSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${parseResult.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    await setLoggingPrefs(parseResult.data);
    const updated = await getLoggingPrefs();

    return reply.code(200).send(updated);
  });

  /**
   * GET /prefs/extension-token - Get extension authentication token
   * Prefers EXT_BOOTSTRAP_TOKEN from env (set by launcher on first install).
   * Falls back to the DB-stored token for backward compatibility.
   */
  fastify.get('/prefs/extension-token', async (request, reply) => {
    const envToken = process.env.EXT_BOOTSTRAP_TOKEN;
    if (envToken) {
      return reply.code(200).send({ token: envToken });
    }
    const tokenData = await getOrInitializeExtensionToken();
    return reply.code(200).send({ token: tokenData.token });
  });
};

export default prefsRoute;
