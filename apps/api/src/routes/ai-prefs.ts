/**
 * Phase 6: AI Preferences Routes
 *
 * Endpoints for managing AI preferences (model selection, temperature, etc.)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPreference, setPreference, type AiPreferences } from '@links/storage';

/**
 * AI Preferences schema
 */
const AiPreferencesSchema = z.object({
  default_model: z.string().optional(),
  task_models: z
    .object({
      tagging: z.string().optional(),
      linking: z.string().optional(),
      summarization: z.string().optional(),
      entity_extraction: z.string().optional(),
      image_tagging: z.string().optional(),
      video_transcription: z.string().optional(),
      audio_transcription: z.string().optional(),
      journaling: z.string().optional(),
      deep_research: z.string().optional(),
      chat: z.string().optional(),
    })
    .optional(),
  mom_models: z
    .object({
      planner: z.string().optional(),
      specialist: z.string().optional(),
      merge: z.string().optional(),
    })
    .optional(),
  nutrition_models: z
    .object({
      meal_image_analysis: z.string().optional(),
      daily_review: z.string().optional(),
      weekly_review: z.string().optional(),
      recipe_generation: z.string().optional(),
      craving_assistant: z.string().optional(),
    })
    .optional(),
  chat_personality_prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

const PREFS_KEY = 'ai.preferences';

/**
 * AI preferences routes plugin
 */
export const aiPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /prefs/ai
   * Get AI preferences
   */
  fastify.get('/prefs/ai', async (request, reply) => {
    const prefs = await getPreference<AiPreferences>(PREFS_KEY);

    // Return empty defaults if not set
    const defaults: AiPreferences = {
      temperature: 0.2, // Low temperature for evidence-based outputs
      max_tokens: 4000,
    };

    return reply.status(200).send(prefs || defaults);
  });

  /**
   * PUT /prefs/ai
   * Update AI preferences (PATCH-like merge behavior)
   */
  fastify.put('/prefs/ai', async (request, reply) => {
    // Validate request body
    const validation = AiPreferencesSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid AI preferences',
        details: validation.error.format(),
      });
    }

    const patch = validation.data;

    // Get existing preferences
    const existing = (await getPreference<AiPreferences>(PREFS_KEY)) || {};

    // Merge patch into existing
    const updated: AiPreferences = {
      ...existing,
      ...patch,
      task_models: {
        ...existing.task_models,
        ...patch.task_models,
      },
      mom_models: {
        ...existing.mom_models,
        ...patch.mom_models,
      },
      nutrition_models: {
        ...existing.nutrition_models,
        ...patch.nutrition_models,
      },
    };

    // Save updated preferences
    await setPreference(PREFS_KEY, updated);

    return reply.status(200).send(updated);
  });
};
