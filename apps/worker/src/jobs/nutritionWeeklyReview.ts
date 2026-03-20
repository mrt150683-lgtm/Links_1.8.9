/**
 * nutrition_weekly_review Job Handler
 *
 * Generates a weekly nutrition review for a given week_key.
 * Idempotent: skips if review already exists.
 * Check-in is optional: runs even without it.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getWeeklyReview,
  getWeeklyCheckIn,
  upsertWeeklyReview,
  listDailyReviews,
  listWellbeingLogs,
  listSupplementEntriesByRange,
  getNutritionProfile,
  buildProfileContext,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import { WeeklyReviewPayloadSchema } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:nutrition-weekly-review' });

export async function nutritionWeeklyReviewHandler(ctx: JobContext): Promise<void> {
  const { jobId, payload } = ctx;
  const { week_key, pot_id, check_in_id } = (payload as any) ?? {};

  if (!week_key || !pot_id) {
    throw new Error('nutrition_weekly_review: missing week_key or pot_id');
  }

  logger.info({ job_id: jobId, week_key, pot_id, msg: 'Starting weekly review' });

  // Idempotency
  const existing = await getWeeklyReview(pot_id, week_key);
  if (existing) {
    logger.info({ job_id: jobId, week_key, msg: 'Weekly review already exists, skipping' });
    return;
  }

  // Load check-in (optional)
  const checkIn = check_in_id
    ? await getWeeklyCheckIn(pot_id, week_key)
    : null;

  const checkInContext = checkIn
    ? [
        checkIn.weight != null ? `Weight: ${checkIn.weight} ${checkIn.weight_unit ?? ''}` : null,
        checkIn.body_fat_pct != null ? `Body fat: ${checkIn.body_fat_pct}%` : null,
        checkIn.rating != null ? `Week rating: ${checkIn.rating}/5` : null,
        checkIn.notes ? `Notes: ${checkIn.notes}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : 'No check-in data provided.';

  // Load daily reviews for context (last 7 days)
  const allReviews = await listDailyReviews(pot_id, 7);
  const reviewContext =
    allReviews.length > 0
      ? allReviews
          .map((r) => {
            const p = r.payload as any;
            return `${r.review_date}: ~${p?.totals?.calories ?? '?'} kcal, ` +
              `gaps: [${(p?.nutritional_gaps ?? []).join(', ')}]`;
          })
          .join('\n')
      : 'No daily review data available.';

  // Derive week date range from week_key (e.g. "2025-W12" → Mon–Sun)
  function weekKeyToRange(wk: string): { from: string; to: string } {
    const [year, weekPart] = wk.split('-W');
    const weekNum = parseInt(weekPart ?? '1', 10);
    // ISO week 1 = first week with Thursday in it
    const jan4 = new Date(Date.UTC(parseInt(year ?? '2025', 10), 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1) + (weekNum - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      from: monday.toISOString().slice(0, 10),
      to: sunday.toISOString().slice(0, 10),
    };
  }

  const { from: weekStart, to: weekEnd } = weekKeyToRange(week_key);

  // Load wellbeing logs for the week
  const wellbeingLogs = await listWellbeingLogs(pot_id, weekStart, weekEnd);
  let wellbeingContext = 'No wellbeing data logged this week.';
  if (wellbeingLogs.length > 0) {
    const avgMood = wellbeingLogs.filter((w) => w.mood != null).map((w) => w.mood!);
    const avgEnergy = wellbeingLogs.filter((w) => w.energy != null).map((w) => w.energy!);
    const avgSleep = wellbeingLogs.filter((w) => w.sleep_quality != null).map((w) => w.sleep_quality!);
    const allSymptoms = wellbeingLogs.flatMap((w) => w.symptoms);
    const symptomFreq: Record<string, number> = {};
    for (const s of allSymptoms) symptomFreq[s] = (symptomFreq[s] ?? 0) + 1;
    const topSymptoms = Object.entries(symptomFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sym, cnt]) => `${sym} (${cnt}x)`);
    const parts: string[] = [`Days logged: ${wellbeingLogs.length}/7`];
    if (avgMood.length) parts.push(`Avg mood: ${(avgMood.reduce((a, b) => a + b, 0) / avgMood.length).toFixed(1)}/5`);
    if (avgEnergy.length) parts.push(`Avg energy: ${(avgEnergy.reduce((a, b) => a + b, 0) / avgEnergy.length).toFixed(1)}/5`);
    if (avgSleep.length) parts.push(`Avg sleep quality: ${(avgSleep.reduce((a, b) => a + b, 0) / avgSleep.length).toFixed(1)}/5`);
    if (topSymptoms.length) parts.push(`Most frequent symptoms: ${topSymptoms.join(', ')}`);
    wellbeingContext = parts.join('\n');
  }

  // Load supplement entries for the week
  const suppEntries = await listSupplementEntriesByRange(pot_id, weekStart, weekEnd);
  let supplementContext = 'No supplements logged this week.';
  if (suppEntries.length > 0) {
    const freq: Record<string, number> = {};
    for (const e of suppEntries) freq[e.supplement_id] = (freq[e.supplement_id] ?? 0) + 1;
    // We don't have supplement names here — use supplement_id counts as context
    const lines = Object.entries(freq).map(([sid, cnt]) => `supplement ${sid.slice(0, 8)}: ${cnt} days`);
    supplementContext = `${suppEntries.length} supplement doses logged across ${Object.keys(freq).length} supplement(s).\n${lines.join('\n')}`;
  }

  // Profile
  const profile = await getNutritionProfile();
  const profileContext = buildProfileContext(profile);

  // Model
  const prefs = await getAIPreferences();
  const modelId = prefs.nutrition_models?.weekly_review ?? prefs.default_model ?? 'google/gemini-2.5-flash';

  const promptPath = join(getPromptsDir(), 'nutrition_weekly_review', 'v1.md');
  const promptTemplate = loadPromptFromFile(promptPath);
  const { system: systemPrompt, user: userMessage } = interpolatePrompt(promptTemplate, {
    week_key,
    profile_context: profileContext,
    check_in_context: checkInContext,
    review_context: reviewContext,
    wellbeing_context: wellbeingContext,
    supplement_context: supplementContext,
  });

  logger.info({ job_id: jobId, week_key, model: modelId, msg: 'Calling AI for weekly review' });

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
        max_tokens: 2000,
      },
      120_000,
    );
    raw = response.choices?.[0]?.message?.content ?? '{}';
  } catch (err) {
    logger.error({ job_id: jobId, week_key, err, msg: 'Weekly review AI call failed' });
    throw err;
  }

  let parsed: unknown;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON in weekly review response: ${raw.slice(0, 200)}`);
  }

  const validation = WeeklyReviewPayloadSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: jobId, error: validation.error.format(), msg: 'Weekly review schema validation failed' });
    throw new Error(`Schema validation failed: ${JSON.stringify(validation.error.format()).slice(0, 500)}`);
  }

  await upsertWeeklyReview(
    pot_id,
    week_key,
    check_in_id ?? null,
    validation.data as unknown as Record<string, unknown>,
    modelId,
    'v1',
  );

  await logAuditEvent({
    actor: 'system',
    action: 'nutrition_weekly_review_created',
    pot_id,
    metadata: { week_key, model_id: modelId },
  });

  logger.info({ job_id: jobId, week_key, msg: 'Weekly review created' });
}
