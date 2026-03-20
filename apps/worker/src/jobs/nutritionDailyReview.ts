/**
 * nutrition_daily_review Job Handler
 *
 * Generates a daily nutrition review for a given date.
 * Idempotent: skips if review already exists.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getDailyReview,
  listNutritionMeals,
  upsertDailyReview,
  getNutritionProfile,
  buildProfileContext,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import { DailyReviewPayloadSchema } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:nutrition-daily-review' });

export async function nutritionDailyReviewHandler(ctx: JobContext): Promise<void> {
  const { jobId, payload } = ctx;
  const { date_key, pot_id } = (payload as any) ?? {};

  if (!date_key || !pot_id) {
    throw new Error('nutrition_daily_review: missing date_key or pot_id');
  }

  logger.info({ job_id: jobId, date_key, pot_id, msg: 'Starting daily review' });

  // Idempotency
  const existing = await getDailyReview(pot_id, date_key);
  if (existing) {
    logger.info({ job_id: jobId, date_key, msg: 'Daily review already exists, skipping' });
    return;
  }

  // Load meals
  const meals = await listNutritionMeals(pot_id, date_key);
  if (meals.length === 0) {
    logger.info({ job_id: jobId, date_key, msg: 'No meals for this date, skipping daily review' });
    return;
  }

  // Build meal context (prefer user_correction over analysis_json)
  const mealContextParts: string[] = [];
  let lowConfidenceCount = 0;

  for (const meal of meals) {
    const data = meal.user_correction ?? meal.analysis_json;
    if (!data) {
      mealContextParts.push(`- ${meal.meal_type}: [no analysis yet]`);
      continue;
    }
    const title = (data as any).meal_title ?? meal.meal_type;
    const totals = (data as any).totals ?? {};
    const confidence = (data as any).portion_confidence ?? 'unknown';
    if (confidence === 'low') lowConfidenceCount++;

    mealContextParts.push(
      `- ${meal.meal_type} (${title}): ~${totals.calories ?? '?'} kcal, ` +
        `protein ${totals.protein_g ?? '?'}g, carbs ${totals.carbs_g ?? '?'}g, fat ${totals.fat_g ?? '?'}g ` +
        `[confidence: ${confidence}${meal.user_correction ? ', user-corrected' : ''}]`,
    );
  }

  const mealContext = mealContextParts.join('\n');

  // Profile context
  const profile = await getNutritionProfile();
  const profileContext = buildProfileContext(profile);

  // Resolve model
  const prefs = await getAIPreferences();
  const modelId = prefs.nutrition_models?.daily_review ?? prefs.default_model ?? 'google/gemini-2.5-flash';

  const promptPath = join(getPromptsDir(), 'nutrition_daily_review', 'v1.md');
  const promptTemplate = loadPromptFromFile(promptPath);
  const { system: systemPrompt, user: userMessage } = interpolatePrompt(promptTemplate, {
    date_key,
    profile_context: profileContext,
    meal_context: mealContext,
    low_confidence_count: String(lowConfidenceCount),
  });

  logger.info({ job_id: jobId, date_key, model: modelId, meal_count: meals.length, msg: 'Calling AI for daily review' });

  let raw: string;
  try {
    const response = await createChatCompletion(
      {
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      },
      90_000,
    );
    raw = response.choices?.[0]?.message?.content ?? '{}';
  } catch (err) {
    logger.error({ job_id: jobId, date_key, err, msg: 'Daily review AI call failed' });
    throw err;
  }

  let parsed: unknown;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON in daily review response: ${raw.slice(0, 200)}`);
  }

  const validation = DailyReviewPayloadSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: jobId, error: validation.error.format(), msg: 'Daily review schema validation failed' });
    throw new Error(`Schema validation failed: ${JSON.stringify(validation.error.format()).slice(0, 500)}`);
  }

  const mealIds = meals.map((m) => m.id);
  await upsertDailyReview(
    pot_id,
    date_key,
    validation.data as unknown as Record<string, unknown>,
    mealIds,
    modelId,
    'v1',
  );

  await logAuditEvent({
    actor: 'system',
    action: 'nutrition_daily_review_created',
    pot_id,
    metadata: { date_key, model_id: modelId, meal_count: meals.length },
  });

  logger.info({ job_id: jobId, date_key, msg: 'Daily review created' });
}
