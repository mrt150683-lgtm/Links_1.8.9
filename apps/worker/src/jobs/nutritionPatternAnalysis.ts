/**
 * nutrition_pattern_analysis Job Handler
 *
 * Analyzes food/symptom or supplement stack patterns over a date range.
 * On-demand only (triggered by user clicking "Analyze" in the UI).
 *
 * 10-step pattern:
 * 1. Validate payload
 * 2. Load meals for date range
 * 3. Load wellbeing logs for date range
 * 4. Load supplement stack for date range
 * 5. Load profile context
 * 6. Resolve model
 * 7. Choose prompt based on analysis_type
 * 8. Call AI (temp 0.2, max_tokens 2500)
 * 9. Validate output schema
 * 10. Store pattern analysis + audit event
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  listNutritionMealsByRange,
  listWellbeingLogs,
  getRecentSupplementStack,
  createPatternAnalysis,
  getNutritionProfile,
  buildProfileContext,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import { PatternAnalysisOutputSchema, StackAnalysisOutputSchema } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:nutrition-pattern-analysis' });

export async function nutritionPatternAnalysisHandler(ctx: JobContext): Promise<void> {
  const { jobId, payload } = ctx;
  const { pot_id, analysis_type, date_range_from, date_range_to } = (payload as any) ?? {};

  // Step 1: Validate payload
  if (!pot_id || !analysis_type || !date_range_from || !date_range_to) {
    throw new Error('nutrition_pattern_analysis: missing required payload fields');
  }
  if (!['food_symptom', 'ingredient_sensitivity', 'stack_review'].includes(analysis_type)) {
    throw new Error(`nutrition_pattern_analysis: invalid analysis_type: ${analysis_type}`);
  }

  logger.info({ job_id: jobId, pot_id, analysis_type, date_range_from, date_range_to, msg: 'Starting pattern analysis' });

  // Step 2: Load meals
  const meals = await listNutritionMealsByRange(pot_id, date_range_from, date_range_to);
  const mealContext = meals.length > 0
    ? meals.map((m) => {
        const data = (m.user_correction ?? m.analysis_json) as any;
        const title = data?.meal_title ?? m.meal_type;
        const cals = data?.totals?.calories;
        const ingredients = (data?.ingredients ?? [])
          .slice(0, 10)
          .map((i: any) => i.name)
          .join(', ');
        return `${m.meal_date} ${m.meal_type}: ${title}${cals ? ` (~${cals} kcal)` : ''}${ingredients ? ` — ${ingredients}` : ''}`;
      }).join('\n')
    : 'No meal data available for this period.';

  // Step 3: Load wellbeing logs
  const wellbeingLogs = await listWellbeingLogs(pot_id, date_range_from, date_range_to);
  const wellbeingContext = wellbeingLogs.length > 0
    ? wellbeingLogs.map((w) => {
        const parts = [`${w.log_date}:`];
        if (w.mood != null) parts.push(`mood ${w.mood}/5`);
        if (w.energy != null) parts.push(`energy ${w.energy}/5`);
        if (w.sleep_quality != null) parts.push(`sleep quality ${w.sleep_quality}/5`);
        if (w.sleep_hours != null) parts.push(`sleep ${w.sleep_hours}h`);
        if (w.anxiety != null) parts.push(`anxiety ${w.anxiety}/5`);
        if (w.symptoms?.length) parts.push(`symptoms: [${w.symptoms.join(', ')}]`);
        if (w.notes) parts.push(`notes: ${w.notes.slice(0, 200)}`);
        return parts.join(' ');
      }).join('\n')
    : 'No wellbeing data available for this period.';

  // Step 4: Load supplement stack
  const days = Math.max(
    1,
    Math.round((new Date(date_range_to).getTime() - new Date(date_range_from).getTime()) / 86_400_000) + 1,
  );
  const stack = await getRecentSupplementStack(pot_id, days);
  const supplementContext = stack.length > 0
    ? stack.map((s) => {
        const doseStr = s.avg_dose != null
          ? `avg ${s.avg_dose.toFixed(1)}${s.dose_unit ? ' ' + s.dose_unit : ''}`
          : 'dose not logged';
        return `${s.name}: ${s.entry_count} days logged, ${doseStr}`;
      }).join('\n')
    : 'No supplement data available for this period.';

  // Step 5: Profile context
  const profile = await getNutritionProfile();
  const profileContext = buildProfileContext(profile);

  // Step 6: Resolve model
  const prefs = await getAIPreferences();
  const modelId = analysis_type === 'stack_review'
    ? (prefs.nutrition_models?.stack_analysis ?? prefs.nutrition_models?.pattern_analysis ?? prefs.default_model ?? 'google/gemini-2.5-flash')
    : (prefs.nutrition_models?.pattern_analysis ?? prefs.default_model ?? 'google/gemini-2.5-flash');

  // Step 7: Choose prompt
  const promptName = analysis_type === 'stack_review' ? 'nutrition_stack_analysis' : 'nutrition_pattern_analysis';
  const promptPath = join(getPromptsDir(), promptName, 'v1.md');
  const promptTemplate = loadPromptFromFile(promptPath);
  const dateRange = `${date_range_from} to ${date_range_to}`;

  const vars = analysis_type === 'stack_review'
    ? {
        date_range: dateRange,
        profile_context: profileContext,
        supplement_context: supplementContext,
        diet_context: mealContext,
      }
    : {
        analysis_type,
        date_range: dateRange,
        profile_context: profileContext,
        meal_context: mealContext,
        wellbeing_context: wellbeingContext,
      };

  const { system: systemPrompt, user: userMessage } = interpolatePrompt(promptTemplate, vars);

  // Step 8: Call AI
  logger.info({ job_id: jobId, model: modelId, analysis_type, msg: 'Calling AI for pattern analysis' });
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
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      },
      120_000,
    );
    raw = response.choices?.[0]?.message?.content ?? '{}';
  } catch (err) {
    logger.error({ job_id: jobId, err, msg: 'Pattern analysis AI call failed' });
    throw err;
  }

  // Step 9: Parse + validate
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON in pattern analysis response: ${raw.slice(0, 200)}`);
  }

  const schema = analysis_type === 'stack_review' ? StackAnalysisOutputSchema : PatternAnalysisOutputSchema;
  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: jobId, error: validation.error.format(), msg: 'Pattern analysis schema validation failed' });
    throw new Error(`Schema validation failed: ${JSON.stringify(validation.error.format()).slice(0, 500)}`);
  }

  // Step 10: Store + audit
  await createPatternAnalysis({
    pot_id,
    analysis_type,
    model_id: modelId,
    prompt_version: 'v1',
    date_range_from,
    date_range_to,
    payload: validation.data as Record<string, unknown>,
    triggered_by: 'manual',
  });

  await logAuditEvent({
    actor: 'system',
    action: 'nutrition_pattern_analysis_created',
    pot_id,
    metadata: { analysis_type, date_range_from, date_range_to, model_id: modelId },
  });

  logger.info({ job_id: jobId, pot_id, analysis_type, msg: 'Pattern analysis complete' });
}
