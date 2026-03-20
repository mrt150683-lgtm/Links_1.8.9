/**
 * Nutrition Module Routes
 *
 * Endpoints:
 *   GET  /nutrition/provision
 *   GET  /nutrition/profile
 *   PUT  /nutrition/profile
 *   POST /nutrition/meals                        (multipart)
 *   GET  /nutrition/meals?date=YYYY-MM-DD
 *   GET  /nutrition/meals/:id
 *   PATCH /nutrition/meals/:id/correction
 *   DELETE /nutrition/meals/:id
 *   POST /nutrition/meals/:id/analyze
 *   POST /nutrition/checkin
 *   GET  /nutrition/checkin/:weekKey
 *   GET  /nutrition/reviews/daily
 *   GET  /nutrition/reviews/daily/:date
 *   GET  /nutrition/reviews/weekly
 *   GET  /nutrition/reviews/weekly/:weekKey
 *   POST /nutrition/recipes/generate
 *   POST /nutrition/cravings
 *   POST /nutrition/recipes/:id/feedback
 *   GET  /nutrition/recipes
 *   GET  /nutrition/recipes/:id
 *   GET  /nutrition/recipe-book
 *   GET  /nutrition/recipe-book/search
 *
 * Migration: 036_nutrition.sql
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  ensureDietPotExists,
  getDietPotId,
  getNutritionProfile,
  setNutritionProfilePatch,
  buildProfileContext,
  createNutritionMeal,
  getNutritionMeal,
  listNutritionMeals,
  updateNutritionMealCorrection,
  deleteNutritionMeal,
  upsertWeeklyCheckIn,
  getWeeklyCheckIn,
  getDailyReview,
  listDailyReviews,
  getWeeklyReview,
  listWeeklyReviews,
  createNutritionRecipe,
  getNutritionRecipe,
  setRecipeFeedback,
  listRecipes,
  searchRecipes,
  getLikedRecipeSummaries,
  getDislikedRecipeSummaries,
  getBySha256,
  insertAsset,
  writeEncryptedAsset,
  enqueueJob,
  getAIPreferences,
  logAuditEvent,
  // wellness addon (037)
  upsertWellbeingLog,
  getWellbeingLog,
  listWellbeingLogs,
  deleteWellbeingLog,
  createSupplement,
  updateSupplement,
  getSupplement,
  listSupplements,
  deactivateSupplement,
  createSupplementEntry,
  listSupplementEntries,
  deleteSupplementEntry,
  createPatternAnalysis,
  listPatternAnalyses,
  getPatternAnalysis,
} from '@links/storage';
import type { NutritionProfile } from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import {
  RecipeGenerationOutputSchema,
  CravingAssistantOutputSchema,
} from '@links/core';
import { createLogger } from '@links/logging';
import { getConfig } from '@links/config';

const logger = createLogger({ name: 'nutrition-routes' });

// ── Validation Schemas ────────────────────────────────────────────────────

const NutritionProfilePatchSchema = z.object({
  weight: z.number().positive().optional(),
  weight_unit: z.enum(['kg', 'lbs']).optional(),
  height: z.number().positive().optional(),
  height_unit: z.enum(['cm', 'ft_in']).optional(),
  height_ft: z.number().positive().optional(),
  height_in: z.number().min(0).max(11).optional(),
  body_fat_pct: z.number().min(0).max(100).optional(),
  dietary_goals: z.array(z.string().max(200)).max(20).optional(),
  likes: z.string().max(10000).optional(),
  dislikes: z.string().max(10000).optional(),
  allergies: z.array(z.string().max(100)).max(50).optional(),
  health_context: z.string().max(2000).optional(),
  units: z.enum(['metric', 'imperial']).optional(),
  timezone: z.string().max(100).optional(),
  preferred_checkin_day: z.number().int().min(0).max(6).optional(),
  preferred_checkin_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const MealCorrectionSchema = z.object({
  user_correction: z.record(z.unknown()),
  accepted: z.boolean().optional(),
});

const WeeklyCheckInSchema = z.object({
  week_key: z.string().regex(/^\d{4}-W\d{2}$/),
  weight: z.number().positive().optional(),
  weight_unit: z.enum(['kg', 'lbs']).optional(),
  body_fat_pct: z.number().min(0).max(100).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
});

const RecipeGenerateSchema = z.object({
  mode: z.enum(['random', 'ingredient_led']),
  ingredients: z.array(z.string().max(100)).max(20).optional(),
  meal_type: z.string().max(50).optional(),
  count: z.number().int().min(2).max(5).optional(),
});

const CravingSchema = z.object({
  craving: z.string().min(1).max(500),
});

const RecipeFeedbackSchema = z.object({
  feedback: z.enum(['liked', 'disliked']),
});

const SYMPTOM_CODES = [
  'bloating', 'stomach_pain', 'nausea', 'constipation', 'digestion_issues',
  'headache', 'fatigue', 'brain_fog', 'grogginess', 'mood_low', 'anxiety_high',
  'craving_sugar', 'craving_salt', 'vivid_dreams', 'felt_good', 'felt_off',
] as const;

const WellbeingLogSchema = z.object({
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symptoms: z.array(z.enum(SYMPTOM_CODES)).max(16).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  sleep_quality: z.number().int().min(1).max(5).nullable().optional(),
  sleep_hours: z.number().min(0).max(24).nullable().optional(),
  anxiety: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const WellbeingPatchSchema = z.object({
  symptoms: z.array(z.enum(SYMPTOM_CODES)).max(16).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  sleep_quality: z.number().int().min(1).max(5).nullable().optional(),
  sleep_hours: z.number().min(0).max(24).nullable().optional(),
  anxiety: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const SupplementCreateSchema = z.object({
  name: z.string().min(1).max(200),
  default_dose: z.number().positive().optional(),
  dose_unit: z.enum(['mg', 'g', 'IU', 'mcg', 'ml', 'capsules', 'drops']).optional(),
  notes: z.string().max(1000).optional(),
});

const SupplementUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  default_dose: z.number().positive().nullable().optional(),
  dose_unit: z.enum(['mg', 'g', 'IU', 'mcg', 'ml', 'capsules', 'drops']).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const SupplementEntryCreateSchema = z.object({
  supplement_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entry_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dose: z.number().positive().optional(),
  dose_unit: z.enum(['mg', 'g', 'IU', 'mcg', 'ml', 'capsules', 'drops']).optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  notes: z.string().max(1000).optional(),
});

const PatternAnalyzeSchema = z.object({
  type: z.enum(['food_symptom', 'ingredient_sensitivity', 'stack_review']),
  days: z.number().int().min(1).max(90).optional().default(14),
});

const WeeklyGenerateSchema = z.object({
  week_key: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
});

// ── Prompt helper ─────────────────────────────────────────────────────────

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  // In packaged Electron app the resources dir lives next to the bundle
  const { join, dirname } = require('node:path');
  try {
    return join(dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

// ── Route Plugin ──────────────────────────────────────────────────────────

export const nutritionRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /nutrition/provision ────────────────────────────────────────────

  fastify.get('/nutrition/provision', async (_request, reply) => {
    const pot_id = await ensureDietPotExists();
    return reply.send({ pot_id });
  });

  // ── GET /nutrition/profile ──────────────────────────────────────────────

  fastify.get('/nutrition/profile', async (_request, reply) => {
    const profile = await getNutritionProfile();
    return reply.send(profile);
  });

  // ── PUT /nutrition/profile ──────────────────────────────────────────────

  fastify.put('/nutrition/profile', async (request, reply) => {
    const result = NutritionProfilePatchSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid profile data',
        details: result.error.format(),
      });
    }
    // Validate timezone if provided
    const tz = result.data.timezone;
    if (tz) {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz });
      } catch {
        return reply.status(400).send({
          error: 'ValidationError',
          message: `Invalid timezone: "${tz}". Use an IANA timezone name like "Europe/London" or "America/New_York".`,
        });
      }
    }
    const profile = await setNutritionProfilePatch(result.data as Partial<NutritionProfile>);
    return reply.send(profile);
  });

  // ── POST /nutrition/meals ───────────────────────────────────────────────

  fastify.post('/nutrition/meals', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) {
      return reply.status(422).send({
        error: 'NoDietPot',
        message: 'Call GET /nutrition/provision first',
      });
    }

    const config = getConfig();

    // Use request.parts() so text fields are captured regardless of their
    // position relative to the file part in the multipart stream.
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let mimeType = 'image/jpeg';
    let originalFilename = 'meal.jpg';

    try {
      for await (const part of (request as any).parts({ limits: { fileSize: config.ASSET_MAX_BYTES } })) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype ?? 'image/jpeg';
          originalFilename = part.filename ?? 'meal.jpg';
        } else {
          fields[part.fieldname] = part.value as string;
        }
      }
    } catch (err: any) {
      if (err?.code === 'FST_FILES_LIMIT' || err?.code === 'FST_FIELDS_LIMIT' || err?.statusCode === 413) {
        return reply.status(413).send({ error: 'FileTooLarge', message: 'File exceeds maximum allowed size' });
      }
      throw err;
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: 'ValidationError', message: 'No file provided' });
    }

    const meal_date = fields['meal_date'];
    const meal_type = fields['meal_type'] as 'breakfast' | 'lunch' | 'dinner' | 'snack';
    const user_note = fields['user_note'];

    if (!meal_date || !meal_type) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'meal_date and meal_type are required',
      });
    }

    if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(meal_type)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'meal_type must be breakfast|lunch|dinner|snack',
      });
    }

    const buffer = fileBuffer;
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    let asset_id: string;

    // Dedup check
    const existing = await getBySha256(sha256);
    if (existing) {
      asset_id = existing.id;
    } else {
      const storagePath = await writeEncryptedAsset(sha256, buffer);
      const asset = await insertAsset({
        sha256,
        size_bytes: buffer.length,
        mime_type: mimeType,
        original_filename: originalFilename,
        storage_path: storagePath,
      });
      asset_id = asset.id;
    }

    const meal = await createNutritionMeal({ pot_id, meal_date, meal_type, asset_id, user_note });

    // Enqueue analysis job
    await enqueueJob({
      job_type: 'nutrition_meal_analysis',
      pot_id,
      payload: { meal_id: meal.id },
      priority: 40,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'nutrition_meal_created',
      pot_id,
      metadata: { meal_id: meal.id, meal_date, meal_type },
    });

    logger.info({ meal_id: meal.id, meal_date, meal_type, msg: 'Meal created' });
    return reply.status(201).send(meal);
  });

  // ── GET /nutrition/meals ────────────────────────────────────────────────

  fastify.get<{ Querystring: { date?: string } }>('/nutrition/meals', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.send({ meals: [] });

    const dateKey = request.query.date ?? new Date().toISOString().slice(0, 10);
    const meals = await listNutritionMeals(pot_id, dateKey);
    return reply.send({ meals });
  });

  // ── GET /nutrition/meals/:id ────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/nutrition/meals/:id', async (request, reply) => {
    const meal = await getNutritionMeal(request.params.id);
    if (!meal) return reply.status(404).send({ error: 'NotFound', message: 'Meal not found' });
    return reply.send(meal);
  });

  // ── PATCH /nutrition/meals/:id/correction ──────────────────────────────

  fastify.patch<{ Params: { id: string } }>(
    '/nutrition/meals/:id/correction',
    async (request, reply) => {
      const meal = await getNutritionMeal(request.params.id);
      if (!meal) return reply.status(404).send({ error: 'NotFound', message: 'Meal not found' });

      const result = MealCorrectionSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
      }

      await updateNutritionMealCorrection(meal.id, {
        user_correction: result.data.user_correction,
        accepted: result.data.accepted,
      });

      const updated = await getNutritionMeal(meal.id);
      return reply.send(updated);
    },
  );

  // ── POST /nutrition/meals/:id/recalculate ─────────────────────────────
  //    AI-assisted macro recalculation for edited ingredients

  const RecalcSchema = z.object({
    ingredients: z.array(z.object({
      name: z.string().min(1),
      quantity: z.string().min(1),
    })).min(1).max(30),
  });

  fastify.post<{ Params: { id: string } }>(
    '/nutrition/meals/:id/recalculate',
    async (request, reply) => {
      const meal = await getNutritionMeal(request.params.id);
      if (!meal) return reply.status(404).send({ error: 'NotFound' });

      const result = RecalcSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
      }

      const prefs = await getAIPreferences();
      const modelId = prefs.nutrition_models?.meal_image_analysis ?? prefs.default_model ?? 'google/gemini-2.5-flash';

      const ingredientList = result.data.ingredients
        .map((i, idx) => `${idx + 1}. ${i.name} — ${i.quantity}`)
        .join('\n');

      const systemPrompt = `You are a nutritionist. Given a list of food items with quantities, estimate the nutritional values for EACH item. Output ONLY valid JSON — no markdown, no commentary.

Output format:
{
  "ingredients": [
    {
      "name": "item name",
      "quantity": "as provided",
      "calories_estimate": <number>,
      "protein_g": <number>,
      "carbs_g": <number>,
      "fat_g": <number>
    }
  ]
}

Rules:
- Return one entry per input ingredient, in the same order
- Use reasonable estimates based on typical preparation methods
- All numeric values should be numbers, not strings
- Round to 1 decimal place for macros, whole numbers for calories`;

      const userMessage = `Estimate the nutritional values for these ingredients:\n\n${ingredientList}`;

      let raw: string;
      try {
        const response = await createChatCompletion(
          {
            model: modelId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
          },
          60_000,
        );
        raw = response.choices?.[0]?.message?.content ?? '{}';
      } catch (err) {
        logger.error({ err, msg: 'Recalculate AI call failed' });
        return reply.status(502).send({ error: 'AIError', message: 'AI recalculation failed' });
      }

      let parsed: any;
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        return reply.status(502).send({ error: 'AIError', message: 'Invalid JSON from AI' });
      }

      if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) {
        return reply.status(502).send({ error: 'AIError', message: 'Invalid response structure' });
      }

      return reply.send({ ingredients: parsed.ingredients });
    },
  );

  // ── DELETE /nutrition/meals/:id ─────────────────────────────────────────

  fastify.delete<{ Params: { id: string } }>('/nutrition/meals/:id', async (request, reply) => {
    const meal = await getNutritionMeal(request.params.id);
    if (!meal) return reply.status(404).send({ error: 'NotFound', message: 'Meal not found' });
    await deleteNutritionMeal(meal.id);
    return reply.send({ ok: true });
  });

  // ── POST /nutrition/meals/:id/analyze ──────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    '/nutrition/meals/:id/analyze',
    async (request, reply) => {
      const meal = await getNutritionMeal(request.params.id);
      if (!meal) return reply.status(404).send({ error: 'NotFound', message: 'Meal not found' });

      await enqueueJob({
        job_type: 'nutrition_meal_analysis',
        pot_id: meal.pot_id,
        payload: { meal_id: meal.id },
        priority: 50,
      });

      return reply.send({ ok: true, meal_id: meal.id });
    },
  );

  // ── POST /nutrition/checkin ─────────────────────────────────────────────

  fastify.post('/nutrition/checkin', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) {
      return reply.status(422).send({ error: 'NoDietPot', message: 'Call GET /nutrition/provision first' });
    }

    const result = WeeklyCheckInSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const { week_key, ...data } = result.data;
    const checkIn = await upsertWeeklyCheckIn(pot_id, week_key, data);

    // Enqueue weekly review (idempotency handled in job)
    await enqueueJob({
      job_type: 'nutrition_weekly_review',
      pot_id,
      payload: { week_key, pot_id, check_in_id: checkIn.id },
      priority: 30,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'nutrition_checkin_submitted',
      pot_id,
      metadata: { week_key },
    });

    return reply.status(201).send(checkIn);
  });

  // ── GET /nutrition/checkin/:weekKey ─────────────────────────────────────

  fastify.get<{ Params: { weekKey: string } }>(
    '/nutrition/checkin/:weekKey',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.status(404).send({ error: 'NotFound' });
      const checkIn = await getWeeklyCheckIn(pot_id, request.params.weekKey);
      if (!checkIn) return reply.status(404).send({ error: 'NotFound' });
      return reply.send(checkIn);
    },
  );

  // ── GET /nutrition/reviews/daily ────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>(
    '/nutrition/reviews/daily',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ reviews: [] });
      const limit = Math.min(Number(request.query.limit ?? 30), 90);
      const reviews = await listDailyReviews(pot_id, limit);
      return reply.send({ reviews });
    },
  );

  // ── GET /nutrition/reviews/daily/:date ──────────────────────────────────

  fastify.get<{ Params: { date: string } }>(
    '/nutrition/reviews/daily/:date',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.status(404).send({ error: 'NotFound' });
      const review = await getDailyReview(pot_id, request.params.date);
      if (!review) return reply.status(404).send({ error: 'NotFound' });
      return reply.send(review);
    },
  );

  // ── GET /nutrition/reviews/weekly ───────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string } }>(
    '/nutrition/reviews/weekly',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ reviews: [] });
      const limit = Math.min(Number(request.query.limit ?? 12), 52);
      const reviews = await listWeeklyReviews(pot_id, limit);
      return reply.send({ reviews });
    },
  );

  // ── GET /nutrition/reviews/weekly/:weekKey ──────────────────────────────

  fastify.get<{ Params: { weekKey: string } }>(
    '/nutrition/reviews/weekly/:weekKey',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.status(404).send({ error: 'NotFound' });
      const review = await getWeeklyReview(pot_id, request.params.weekKey);
      if (!review) return reply.status(404).send({ error: 'NotFound' });
      return reply.send(review);
    },
  );

  // ── POST /nutrition/recipes/generate ────────────────────────────────────

  fastify.post('/nutrition/recipes/generate', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) {
      return reply.status(422).send({ error: 'NoDietPot' });
    }

    const result = RecipeGenerateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const { mode, ingredients, meal_type, count = 3 } = result.data;
    const profile = await getNutritionProfile();
    const profileCtx = buildProfileContext(profile);

    const [likedSummaries, dislikedSummaries, prefs] = await Promise.all([
      getLikedRecipeSummaries(pot_id, 10),
      getDislikedRecipeSummaries(pot_id, 10),
      getAIPreferences(),
    ]);

    const modelId =
      prefs.nutrition_models?.recipe_generation ??
      prefs.default_model ??
      'google/gemini-2.5-flash';

    const likedCtx =
      likedSummaries.length > 0
        ? likedSummaries.map((r) => `- ${r.title} (${r.cuisine_tags.join(', ')})`).join('\n')
        : 'None yet.';
    const dislikedCtx =
      dislikedSummaries.length > 0
        ? dislikedSummaries.map((r) => `- ${r.title} (${r.cuisine_tags.join(', ')})`).join('\n')
        : 'None yet.';

    const ingredientInstruction =
      mode === 'ingredient_led' && ingredients?.length
        ? `Feature these ingredients: ${ingredients.join(', ')}.`
        : 'No specific ingredient constraint.';

    const recipePromptTemplate = loadPromptFromFile(
      require('node:path').join(getPromptsDir(), 'nutrition_recipe_generation', 'v1.md'),
    );
    const { system: systemPrompt, user: userMessage } = interpolatePrompt(recipePromptTemplate, {
      count: String(count),
      meal_type: meal_type ?? 'any',
      ingredient_instruction: ingredientInstruction,
      profile_context: profileCtx,
      liked_context: likedCtx,
      disliked_context: dislikedCtx,
    });

    logger.info({ pot_id, mode, count, modelId, msg: 'Generating recipes' });

    let raw: string;
    try {
      const response = await createChatCompletion(
        {
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.4,
          max_tokens: 4000,
        },
        120_000,
      );
      raw = response.choices?.[0]?.message?.content ?? '{}';
    } catch (err) {
      logger.error({ err, msg: 'Recipe generation AI call failed' });
      return reply.status(502).send({ error: 'AIError', message: 'Recipe generation failed' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.status(502).send({ error: 'AIError', message: 'Invalid JSON from AI' });
    }

    const validated = RecipeGenerationOutputSchema.safeParse(parsed);
    if (!validated.success) {
      logger.error({ err: validated.error, msg: 'Recipe schema validation failed' });
      return reply.status(502).send({ error: 'AIError', message: 'Invalid recipe output schema' });
    }

    const savedRecipes = await Promise.all(
      validated.data.recipes.map((recipe) =>
        createNutritionRecipe({
          pot_id,
          title: recipe.title,
          category: recipe.category,
          cuisine_tags: recipe.cuisine_tags,
          key_ingredients: recipe.key_ingredients,
          flavor_profile: recipe.flavor_profile,
          meal_type_tags: recipe.meal_type_tags,
          full_recipe: recipe as unknown as Record<string, unknown>,
          generation_mode: mode,
          source_prompt: `mode:${mode}`,
          model_id: modelId,
          prompt_version: 'v1',
        }),
      ),
    );

    return reply.send({ recipes: savedRecipes });
  });

  // ── POST /nutrition/cravings ─────────────────────────────────────────────

  fastify.post('/nutrition/cravings', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) {
      return reply.status(422).send({ error: 'NoDietPot' });
    }

    const result = CravingSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const { craving } = result.data;
    const profile = await getNutritionProfile();
    const profileCtx = buildProfileContext(profile);

    const [likedSummaries, dislikedSummaries, prefs] = await Promise.all([
      getLikedRecipeSummaries(pot_id, 10),
      getDislikedRecipeSummaries(pot_id, 10),
      getAIPreferences(),
    ]);

    const modelId =
      prefs.nutrition_models?.craving_assistant ??
      prefs.default_model ??
      'google/gemini-2.5-flash';

    const likedCtx =
      likedSummaries.length > 0
        ? likedSummaries.map((r) => `- ${r.title} (${r.cuisine_tags.join(', ')})`).join('\n')
        : 'None yet.';
    const dislikedCtx =
      dislikedSummaries.length > 0
        ? dislikedSummaries.map((r) => `- ${r.title}`).join('\n')
        : 'None yet.';

    const cravingPromptTemplate = loadPromptFromFile(
      require('node:path').join(getPromptsDir(), 'nutrition_craving_assistant', 'v1.md'),
    );
    const { system: systemPrompt, user: userMessage } = interpolatePrompt(cravingPromptTemplate, {
      craving,
      profile_context: profileCtx,
      liked_context: likedCtx,
      disliked_context: dislikedCtx,
    });

    logger.info({ pot_id, craving, modelId, msg: 'Processing craving' });

    let raw: string;
    try {
      const response = await createChatCompletion(
        {
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.4,
          max_tokens: 3000,
        },
        120_000,
      );
      raw = response.choices?.[0]?.message?.content ?? '{}';
    } catch (err) {
      logger.error({ err, msg: 'Craving assistant AI call failed' });
      return reply.status(502).send({ error: 'AIError', message: 'Craving assistant failed' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.status(502).send({ error: 'AIError', message: 'Invalid JSON from AI' });
    }

    const validated = CravingAssistantOutputSchema.safeParse(parsed);
    if (!validated.success) {
      logger.error({ err: validated.error, msg: 'Craving schema validation failed' });
      return reply.status(502).send({ error: 'AIError', message: 'Invalid craving output schema' });
    }

    // Save each alternative as a recipe
    const savedRecipes = await Promise.all(
      validated.data.alternatives.map((alt) =>
        createNutritionRecipe({
          pot_id,
          title: alt.title,
          category: alt.category,
          cuisine_tags: alt.cuisine_tags,
          key_ingredients: alt.key_ingredients,
          flavor_profile: alt.similarity_to_craving,
          meal_type_tags: alt.meal_type_tags,
          full_recipe: alt as unknown as Record<string, unknown>,
          generation_mode: 'craving',
          source_prompt: craving,
          model_id: modelId,
          prompt_version: 'v1',
        }),
      ),
    );

    return reply.send({
      craving_interpreted_as: validated.data.craving_interpreted_as,
      alternatives: savedRecipes,
    });
  });

  // ── POST /nutrition/recipes/:id/feedback ────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    '/nutrition/recipes/:id/feedback',
    async (request, reply) => {
      const recipe = await getNutritionRecipe(request.params.id);
      if (!recipe) return reply.status(404).send({ error: 'NotFound' });

      const result = RecipeFeedbackSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
      }

      await setRecipeFeedback(recipe.id, result.data.feedback);
      return reply.send({ ok: true });
    },
  );

  // ── GET /nutrition/recipes ──────────────────────────────────────────────

  fastify.get<{
    Querystring: { feedback?: string; category?: string; limit?: string; offset?: string };
  }>('/nutrition/recipes', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.send({ recipes: [], total: 0 });

    const q = request.query;
    const { recipes, total } = await listRecipes(pot_id, {
      feedback: q.feedback as any,
      category: q.category as any,
      limit: q.limit ? Math.min(Number(q.limit), 50) : 20,
      offset: q.offset ? Number(q.offset) : 0,
    });

    return reply.send({ recipes, total });
  });

  // ── GET /nutrition/recipes/:id ──────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/nutrition/recipes/:id', async (request, reply) => {
    const recipe = await getNutritionRecipe(request.params.id);
    if (!recipe) return reply.status(404).send({ error: 'NotFound' });
    return reply.send(recipe);
  });

  // ── GET /nutrition/recipe-book ──────────────────────────────────────────

  fastify.get<{ Querystring: { category?: string; limit?: string; offset?: string } }>(
    '/nutrition/recipe-book',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ recipes: [], total: 0 });

      const q = request.query;
      const { recipes, total } = await listRecipes(pot_id, {
        feedback: 'liked',
        category: q.category as any,
        limit: q.limit ? Math.min(Number(q.limit), 50) : 20,
        offset: q.offset ? Number(q.offset) : 0,
      });

      return reply.send({ recipes, total });
    },
  );

  // ── GET /nutrition/recipe-book/search ───────────────────────────────────

  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/nutrition/recipe-book/search',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ recipes: [] });

      const query = request.query.q ?? '';
      const limit = Math.min(Number(request.query.limit ?? 20), 50);
      const recipes = await searchRecipes(pot_id, query, limit);
      return reply.send({ recipes });
    },
  );

  // ── POST /nutrition/reviews/weekly/generate ──────────────────────────────

  fastify.post('/nutrition/reviews/weekly/generate', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = WeeklyGenerateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    function currentWeekKey(): string {
      const now = new Date();
      const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
      const thu = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4 - dow));
      const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const wn = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${thu.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
    }

    const week_key = result.data.week_key ?? currentWeekKey();
    const job = await enqueueJob({ job_type: 'nutrition_weekly_review', pot_id, payload: { pot_id, week_key } });
    return reply.send({ ok: true, job_id: job.id, week_key });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Wellbeing Routes (037)
  // ─────────────────────────────────────────────────────────────────────────

  // ── POST /nutrition/wellbeing ─────────────────────────────────────────────

  fastify.post('/nutrition/wellbeing', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = WellbeingLogSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const { log_date, ...data } = result.data;
    // Coerce null → undefined for repo input (Zod .nullable() keeps null,
    // but UpsertWellbeingLogInput expects undefined for unset values)
    const cleaned = {
      symptoms: data.symptoms,
      mood: data.mood ?? undefined,
      energy: data.energy ?? undefined,
      sleep_quality: data.sleep_quality ?? undefined,
      sleep_hours: data.sleep_hours ?? undefined,
      anxiety: data.anxiety ?? undefined,
      notes: data.notes ?? undefined,
    };
    const log = await upsertWellbeingLog(pot_id, log_date, cleaned);
    return reply.send(log);
  });

  // ── GET /nutrition/wellbeing ──────────────────────────────────────────────

  fastify.get<{ Querystring: { date?: string } }>('/nutrition/wellbeing', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(404).send({ error: 'NoDietPot' });

    const date = request.query.date ?? new Date().toISOString().slice(0, 10);
    const log = await getWellbeingLog(pot_id, date);
    if (!log) return reply.status(404).send({ error: 'NotFound' });
    return reply.send(log);
  });

  // ── GET /nutrition/wellbeing/range ────────────────────────────────────────

  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/nutrition/wellbeing/range',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ logs: [] });

      const to = request.query.to ?? new Date().toISOString().slice(0, 10);
      const fromDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const from = request.query.from ?? fromDate;
      const logs = await listWellbeingLogs(pot_id, from, to);
      return reply.send({ logs });
    },
  );

  // ── PATCH /nutrition/wellbeing/:id ────────────────────────────────────────

  fastify.patch<{ Params: { id: string } }>('/nutrition/wellbeing/:id', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = WellbeingPatchSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    // Find the log by ID — list from pot and match
    // Use listWellbeingLogs over a long range to find the entry
    const today = new Date().toISOString().slice(0, 10);
    const farPast = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const allLogs = await listWellbeingLogs(pot_id, farPast, today);
    const log = allLogs.find((l) => l.id === request.params.id);
    if (!log) return reply.status(404).send({ error: 'NotFound' });

    const merged = {
      symptoms: result.data.symptoms ?? log.symptoms,
      mood: result.data.mood ?? log.mood ?? undefined,
      energy: result.data.energy ?? log.energy ?? undefined,
      sleep_quality: result.data.sleep_quality ?? log.sleep_quality ?? undefined,
      sleep_hours: result.data.sleep_hours ?? log.sleep_hours ?? undefined,
      anxiety: result.data.anxiety ?? log.anxiety ?? undefined,
      notes: result.data.notes ?? log.notes ?? undefined,
    };
    const updated = await upsertWellbeingLog(pot_id, log.log_date, merged);
    return reply.send(updated);
  });

  // ── DELETE /nutrition/wellbeing/:id ──────────────────────────────────────

  fastify.delete<{ Params: { id: string } }>('/nutrition/wellbeing/:id', async (request, reply) => {
    await deleteWellbeingLog(request.params.id);
    return reply.send({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Supplement Catalog Routes (037)
  // ─────────────────────────────────────────────────────────────────────────

  // ── GET /nutrition/supplements ────────────────────────────────────────────

  fastify.get<{ Querystring: { active_only?: string } }>(
    '/nutrition/supplements',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ supplements: [] });
      const activeOnly = request.query.active_only === 'true';
      const supplements = await listSupplements(pot_id, activeOnly);
      return reply.send({ supplements });
    },
  );

  // ── POST /nutrition/supplements ───────────────────────────────────────────

  fastify.post('/nutrition/supplements', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = SupplementCreateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const supplement = await createSupplement({ pot_id, ...result.data });
    return reply.status(201).send(supplement);
  });

  // ── PATCH /nutrition/supplements/:id ─────────────────────────────────────

  fastify.patch<{ Params: { id: string } }>(
    '/nutrition/supplements/:id',
    async (request, reply) => {
      const existing = await getSupplement(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'NotFound' });

      const result = SupplementUpdateSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
      }

      const updated = await updateSupplement(request.params.id, result.data);
      return reply.send(updated);
    },
  );

  // ── DELETE /nutrition/supplements/:id ─────────────────────────────────────

  fastify.delete<{ Params: { id: string } }>(
    '/nutrition/supplements/:id',
    async (request, reply) => {
      const existing = await getSupplement(request.params.id);
      if (!existing) return reply.status(404).send({ error: 'NotFound' });
      await deactivateSupplement(request.params.id);
      return reply.send({ ok: true });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Supplement Entry Routes (037)
  // ─────────────────────────────────────────────────────────────────────────

  // ── GET /nutrition/supplements/entries ───────────────────────────────────

  fastify.get<{ Querystring: { date?: string } }>(
    '/nutrition/supplements/entries',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ entries: [] });
      const date = request.query.date ?? new Date().toISOString().slice(0, 10);
      const entries = await listSupplementEntries(pot_id, date);
      return reply.send({ entries });
    },
  );

  // ── POST /nutrition/supplements/entries ──────────────────────────────────

  fastify.post('/nutrition/supplements/entries', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = SupplementEntryCreateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    // Validate supplement exists
    const supp = await getSupplement(result.data.supplement_id);
    if (!supp) return reply.status(404).send({ error: 'SupplementNotFound' });

    const entry = await createSupplementEntry({ pot_id, ...result.data });
    return reply.status(201).send(entry);
  });

  // ── DELETE /nutrition/supplements/entries/:id ─────────────────────────────

  fastify.delete<{ Params: { id: string } }>(
    '/nutrition/supplements/entries/:id',
    async (request, reply) => {
      await deleteSupplementEntry(request.params.id);
      return reply.send({ ok: true });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Pattern Analysis Routes (037)
  // ─────────────────────────────────────────────────────────────────────────

  // ── POST /nutrition/patterns/analyze ─────────────────────────────────────

  fastify.post('/nutrition/patterns/analyze', async (request, reply) => {
    const pot_id = await getDietPotId();
    if (!pot_id) return reply.status(422).send({ error: 'NoDietPot' });

    const result = PatternAnalyzeSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'ValidationError', details: result.error.format() });
    }

    const { type, days } = result.data;
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - (days ?? 14) * 86_400_000).toISOString().slice(0, 10);

    const job = await enqueueJob({
      job_type: 'nutrition_pattern_analysis',
      pot_id,
      payload: { pot_id, analysis_type: type, date_range_from: fromDate, date_range_to: toDate },
    });

    return reply.status(202).send({ ok: true, job_id: job.id, date_range_from: fromDate, date_range_to: toDate });
  });

  // ── GET /nutrition/patterns ───────────────────────────────────────────────

  fastify.get<{ Querystring: { type?: string; limit?: string } }>(
    '/nutrition/patterns',
    async (request, reply) => {
      const pot_id = await getDietPotId();
      if (!pot_id) return reply.send({ analyses: [] });
      const type = request.query.type as any;
      const limit = Math.min(Number(request.query.limit ?? 20), 50);
      const analyses = await listPatternAnalyses(pot_id, type, limit);
      return reply.send({ analyses });
    },
  );

  // ── GET /nutrition/patterns/:id ───────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/nutrition/patterns/:id', async (request, reply) => {
    const analysis = await getPatternAnalysis(request.params.id);
    if (!analysis) return reply.status(404).send({ error: 'NotFound' });
    return reply.send(analysis);
  });
};

// ── Prompt Builders ───────────────────────────────────────────────────────

