/**
 * OpenRouter API Key management
 *
 * Stores the API key in user_prefs so it can be configured through the UI
 * without requiring manual .env file edits. Stored key takes priority over
 * the OPENROUTER_API_KEY environment variable.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPreference, setPreference } from '@links/storage';

const PREFS_KEY = 'openrouter.api_key';

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 7) + '****' + key.slice(-4);
}

export const openrouterKeyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/openrouter-key
   * Returns whether a key is configured and a masked hint.
   * Never returns the raw key.
   */
  fastify.get('/prefs/openrouter-key', async (_request, reply) => {
    const stored = await getPreference<string>(PREFS_KEY);
    if (stored) {
      return reply.status(200).send({ configured: true, hint: maskKey(stored), source: 'prefs' });
    }
    const envKey = process.env.OPENROUTER_API_KEY;
    if (envKey) {
      return reply.status(200).send({ configured: true, hint: maskKey(envKey), source: 'env' });
    }
    return reply.status(200).send({ configured: false, hint: null, source: null });
  });

  /**
   * PUT /prefs/openrouter-key
   * Save or clear the OpenRouter API key.
   * Empty string clears the stored key (reverts to env var if set).
   * Takes effect immediately without restart.
   */
  fastify.put('/prefs/openrouter-key', async (request, reply) => {
    const schema = z.object({ api_key: z.string() });
    const validation = schema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({ error: 'ValidationError', message: 'api_key (string) is required' });
    }

    const { api_key } = validation.data;

    if (api_key === '') {
      // Clear stored key
      await setPreference(PREFS_KEY, null);
      // Revert process.env to whatever was set at startup (or unset it)
      const originalEnvKey = process.env.LINKS_ORIGINAL_OPENROUTER_KEY;
      if (originalEnvKey) {
        process.env.OPENROUTER_API_KEY = originalEnvKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
      const envKey = process.env.OPENROUTER_API_KEY;
      return reply.status(200).send({
        configured: !!envKey,
        hint: envKey ? maskKey(envKey) : null,
        source: envKey ? 'env' : null,
      });
    }

    await setPreference(PREFS_KEY, api_key);
    // Override env var immediately so existing AI client picks it up
    process.env.OPENROUTER_API_KEY = api_key;

    return reply.status(200).send({ configured: true, hint: maskKey(api_key), source: 'prefs' });
  });
};

/**
 * Call this once at server startup (after DB is initialized).
 * Reads any stored API key from user_prefs and overrides the env var.
 */
export async function initOpenRouterKeyFromPrefs(): Promise<void> {
  // Preserve the original env key so we can restore it if the user clears the stored key
  if (process.env.OPENROUTER_API_KEY) {
    process.env.LINKS_ORIGINAL_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  }

  const stored = await getPreference<string>(PREFS_KEY);
  if (stored) {
    process.env.OPENROUTER_API_KEY = stored;
    console.log('[openrouter] API key loaded from user_prefs (overrides env var)');
  }
}
