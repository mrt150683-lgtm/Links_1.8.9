/**
 * nutrition_meal_analysis Job Handler
 *
 * Analyzes a meal photo using a vision-capable AI model.
 * Stores the structured analysis result in nutrition_meals.analysis_json.
 *
 * 10-step pattern:
 * 1. Validate payload
 * 2. Load meal record
 * 3. Resolve model
 * 4. Load + decrypt asset; encode as base64 data URI
 * 5. Load NutritionProfile → build profile_context
 * 6. Build multimodal message
 * 7. Call AI (vision)
 * 8. Parse JSON, validate with MealAnalysisArtifactSchema
 * 9. On success: updateNutritionMealAnalysis; on failure: updateNutritionMealError
 * 10. Audit event
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getNutritionMeal,
  updateNutritionMealAnalysis,
  updateNutritionMealError,
  getAssetById,
  readDecryptedAsset,
  getAIPreferences,
  logAuditEvent,
  getNutritionProfile,
  buildProfileContext,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import { MealAnalysisArtifactSchema } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:nutrition-meal-analysis' });

export async function nutritionMealAnalysisHandler(ctx: JobContext): Promise<void> {
  const { jobId, payload } = ctx;

  // 1. Validate payload
  const meal_id = (payload as any)?.meal_id as string | undefined;
  if (!meal_id) {
    throw new Error('nutrition_meal_analysis: missing meal_id in payload');
  }

  logger.info({ job_id: jobId, meal_id, msg: 'Starting meal analysis' });

  // 2. Load meal
  const meal = await getNutritionMeal(meal_id);
  if (!meal) {
    throw new Error(`nutrition_meal_analysis: meal not found: ${meal_id}`);
  }

  if (!meal.asset_id) {
    await updateNutritionMealError(meal_id, 'No image asset attached to this meal');
    logger.warn({ job_id: jobId, meal_id, msg: 'Meal has no asset_id, skipping' });
    return;
  }

  // Skip if already analyzed
  if (meal.analysis_json) {
    logger.info({ job_id: jobId, meal_id, msg: 'Meal already analyzed, skipping' });
    return;
  }

  // 3. Resolve model
  const prefs = await getAIPreferences();
  const modelId =
    prefs.nutrition_models?.meal_image_analysis ??
    prefs.default_model ??
    'google/gemini-2.5-flash';

  // 4. Load + decrypt asset
  const asset = await getAssetById(meal.asset_id);
  if (!asset) {
    await updateNutritionMealError(meal_id, 'Asset record not found');
    return;
  }

  let imageBase64: string;
  try {
    const buffer = await readDecryptedAsset(asset.storage_path);
    imageBase64 = buffer.toString('base64');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateNutritionMealError(meal_id, `Failed to read asset: ${msg}`);
    throw err;
  }

  const mimeType = asset.mime_type || 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${imageBase64}`;

  // 5. Build profile context
  const profile = await getNutritionProfile();
  const profileContext = buildProfileContext(profile);

  // 6. Load prompt from file and interpolate dynamic values
  const promptPath = join(getPromptsDir(), 'nutrition_meal_analysis', 'v1.md');
  const promptTemplate = loadPromptFromFile(promptPath);
  const { system: systemPrompt, user: userMessage } = interpolatePrompt(promptTemplate, {
    meal_type: meal.meal_type,
    profile_context: profileContext,
  });

  // 7. Call AI
  logger.info({ job_id: jobId, meal_id, model: modelId, msg: 'Calling vision AI' });

  let raw: string;
  try {
    const response = await createChatCompletion(
      {
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUri },
              },
              {
                type: 'text',
                text: userMessage,
              },
            ] as any,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      },
      120_000,
    );
    raw = response.choices?.[0]?.message?.content ?? '{}';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateNutritionMealError(meal_id, `AI call failed: ${msg}`);
    throw err;
  }

  // 8. Parse and validate
  let parsed: unknown;
  try {
    // Strip any markdown code fences if the model added them
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const msg = `Invalid JSON in AI response: ${raw.slice(0, 200)}`;
    await updateNutritionMealError(meal_id, msg);
    throw new Error(msg);
  }

  const validation = MealAnalysisArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    const msg = `Schema validation failed: ${JSON.stringify(validation.error.format()).slice(0, 500)}`;
    logger.warn({ job_id: jobId, meal_id, error: validation.error.format(), msg: 'Schema mismatch' });
    await updateNutritionMealError(meal_id, msg);
    throw new Error(msg);
  }

  // 9. Store result
  await updateNutritionMealAnalysis(meal_id, validation.data as unknown as Record<string, unknown>);

  // 10. Audit
  await logAuditEvent({
    actor: 'system',
    action: 'nutrition_meal_analyzed',
    pot_id: meal.pot_id,
    metadata: {
      meal_id,
      model_id: modelId,
      portion_confidence: validation.data.portion_confidence,
      image_quality: validation.data.image_quality,
    },
  });

  logger.info({
    job_id: jobId,
    meal_id,
    portion_confidence: validation.data.portion_confidence,
    msg: 'Meal analysis complete',
  });
}
