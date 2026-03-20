/**
 * Scout Preferences Routes
 *
 * Endpoints for managing Scout/RepoForge preferences
 * (GitHub token, default model, search parameters).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPreference, setPreference } from '@links/storage';

/** Stored shape (raw — includes the real token). */
interface ScoutPreferences {
  github_token?: string;
  default_model?: string;
  default_days?: number;
  default_stars?: number;
  default_max_stars?: number;
  default_top_n?: number;
  default_language?: string;
  default_include_forks?: boolean;
}

const ScoutPreferencesSchema = z.object({
  github_token: z.string().optional(),
  default_model: z.string().optional(),
  default_days: z.number().int().positive().optional(),
  default_stars: z.number().int().nonnegative().optional(),
  default_max_stars: z.number().int().positive().optional(),
  default_top_n: z.number().int().positive().optional(),
  default_language: z.string().optional(),
  default_include_forks: z.boolean().optional(),
});

const PREFS_KEY = 'scout.preferences';

/** Mask a GitHub token for safe display: "ghp_****ab12" */
function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

export const scoutPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/scout
   * Returns preferences with the token **masked** (never the raw value).
   */
  fastify.get('/prefs/scout', async (_request, reply) => {
    const prefs = await getPreference<ScoutPreferences>(PREFS_KEY);

    const hasToken = !!prefs?.github_token;

    return reply.status(200).send({
      github_token_set: hasToken,
      github_token_hint: hasToken ? maskToken(prefs!.github_token!) : null,
      default_model: prefs?.default_model ?? null,
      default_days: prefs?.default_days ?? null,
      default_stars: prefs?.default_stars ?? null,
      default_max_stars: prefs?.default_max_stars ?? null,
      default_top_n: prefs?.default_top_n ?? null,
      default_language: prefs?.default_language ?? null,
      default_include_forks: prefs?.default_include_forks ?? null,
    });
  });

  /**
   * PUT /prefs/scout
   * PATCH-like merge. Empty string for github_token clears it.
   */
  fastify.put('/prefs/scout', async (request, reply) => {
    const validation = ScoutPreferencesSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid Scout preferences',
        details: validation.error.format(),
      });
    }

    const patch = validation.data;
    const existing = (await getPreference<ScoutPreferences>(PREFS_KEY)) || {};

    const updated: ScoutPreferences = { ...existing, ...patch };

    // Trim whitespace from token to guard against paste artifacts
    if (updated.github_token) {
      updated.github_token = updated.github_token.trim();
    }

    // Empty string means "clear the token"
    if (patch.github_token === '') {
      delete updated.github_token;
    }

    await setPreference(PREFS_KEY, updated);

    // Return masked view
    const hasToken = !!updated.github_token;
    return reply.status(200).send({
      github_token_set: hasToken,
      github_token_hint: hasToken ? maskToken(updated.github_token!) : null,
      default_model: updated.default_model ?? null,
      default_days: updated.default_days ?? null,
      default_stars: updated.default_stars ?? null,
      default_max_stars: updated.default_max_stars ?? null,
      default_top_n: updated.default_top_n ?? null,
      default_language: updated.default_language ?? null,
      default_include_forks: updated.default_include_forks ?? null,
    });
  });
};
