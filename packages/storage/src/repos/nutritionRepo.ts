/**
 * Nutrition Repository
 *
 * CRUD operations for nutrition module tables:
 *   - nutrition_meals
 *   - nutrition_daily_reviews
 *   - nutrition_weekly_check_ins
 *   - nutrition_weekly_reviews
 *   - nutrition_recipes
 *
 * Migration: 036_nutrition.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  NutritionMeal,
  NutritionDailyReview,
  NutritionWeeklyCheckIn,
  NutritionWeeklyReview,
  NutritionRecipe,
  NutritionPatternAnalysis,
  CreateNutritionMealInput,
  CreateNutritionRecipeInput,
  CreateNutritionPatternAnalysisInput,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toNutritionMeal(row: any): NutritionMeal {
  return {
    id: row.id,
    pot_id: row.pot_id,
    meal_date: row.meal_date,
    meal_type: row.meal_type,
    asset_id: row.asset_id,
    user_note: row.user_note,
    user_correction: row.user_correction ? JSON.parse(row.user_correction) : null,
    analysis_json: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    error_message: row.error_message,
    accepted: row.accepted === 1,
    created_at: row.created_at as number,
    updated_at: row.updated_at,
  };
}

function toDailyReview(row: any): NutritionDailyReview {
  return {
    id: row.id,
    pot_id: row.pot_id,
    review_date: row.review_date,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    payload: JSON.parse(row.payload_json),
    meal_ids: JSON.parse(row.meal_ids_json),
    created_at: row.created_at as number,
  };
}

function toWeeklyCheckIn(row: any): NutritionWeeklyCheckIn {
  return {
    id: row.id,
    pot_id: row.pot_id,
    week_key: row.week_key,
    weight: row.weight,
    weight_unit: row.weight_unit,
    body_fat_pct: row.body_fat_pct,
    rating: row.rating,
    notes: row.notes,
    submitted_at: row.submitted_at,
  };
}

function toWeeklyReview(row: any): NutritionWeeklyReview {
  return {
    id: row.id,
    pot_id: row.pot_id,
    week_key: row.week_key,
    check_in_id: row.check_in_id,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at as number,
  };
}

function toNutritionRecipe(row: any): NutritionRecipe {
  return {
    id: row.id,
    pot_id: row.pot_id,
    title: row.title,
    category: row.category,
    cuisine_tags: JSON.parse(row.cuisine_tags),
    key_ingredients: JSON.parse(row.key_ingredients),
    flavor_profile: row.flavor_profile,
    meal_type_tags: JSON.parse(row.meal_type_tags),
    full_recipe: JSON.parse(row.full_recipe_json),
    feedback: row.feedback,
    generation_mode: row.generation_mode,
    source_prompt: row.source_prompt,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    created_at: row.created_at as number,
    updated_at: row.updated_at,
  };
}

// ── Meals ─────────────────────────────────────────────────────────────────

export async function createNutritionMeal(input: CreateNutritionMealInput): Promise<NutritionMeal> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_meals')
    .values({
      id,
      pot_id: input.pot_id,
      meal_date: input.meal_date,
      meal_type: input.meal_type,
      asset_id: input.asset_id ?? null,
      user_note: input.user_note ?? null,
      user_correction: null,
      analysis_json: null,
      error_message: null,
      accepted: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    meal_date: input.meal_date,
    meal_type: input.meal_type,
    asset_id: input.asset_id ?? null,
    user_note: input.user_note ?? null,
    user_correction: null,
    analysis_json: null,
    error_message: null,
    accepted: false,
    created_at: now,
    updated_at: now,
  };
}

export async function getNutritionMeal(id: string): Promise<NutritionMeal | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_meals')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toNutritionMeal(row) : undefined;
}

export async function listNutritionMeals(potId: string, dateKey: string): Promise<NutritionMeal[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_meals')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('meal_date', '=', dateKey)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toNutritionMeal);
}

export async function listNutritionMealsByRange(
  potId: string,
  from: string,
  to: string,
): Promise<NutritionMeal[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_meals')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('meal_date', '>=', from)
    .where('meal_date', '<=', to)
    .orderBy('meal_date', 'desc')
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toNutritionMeal);
}

export async function updateNutritionMealAnalysis(
  id: string,
  analysisJson: Record<string, unknown>,
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('nutrition_meals')
    .set({
      analysis_json: JSON.stringify(analysisJson),
      error_message: null,
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function updateNutritionMealError(id: string, errorMessage: string): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('nutrition_meals')
    .set({ error_message: errorMessage, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

export async function updateNutritionMealCorrection(
  id: string,
  opts: { user_correction: Record<string, unknown>; accepted?: boolean },
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('nutrition_meals')
    .set({
      user_correction: JSON.stringify(opts.user_correction),
      accepted: opts.accepted ? 1 : 0,
      updated_at: Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function deleteNutritionMeal(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('nutrition_meals').where('id', '=', id).execute();
}

// ── Daily Reviews ─────────────────────────────────────────────────────────

export async function upsertDailyReview(
  potId: string,
  reviewDate: string,
  payload: Record<string, unknown>,
  mealIds: string[],
  modelId: string,
  promptVersion: string,
): Promise<NutritionDailyReview> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_daily_reviews')
    .values({
      id,
      pot_id: potId,
      review_date: reviewDate,
      model_id: modelId,
      prompt_version: promptVersion,
      payload_json: JSON.stringify(payload),
      meal_ids_json: JSON.stringify(mealIds),
      created_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['pot_id', 'review_date']).doUpdateSet({
        model_id: modelId,
        prompt_version: promptVersion,
        payload_json: JSON.stringify(payload),
        meal_ids_json: JSON.stringify(mealIds),
      }),
    )
    .execute();

  const row = await db
    .selectFrom('nutrition_daily_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('review_date', '=', reviewDate)
    .executeTakeFirstOrThrow();

  return toDailyReview(row);
}

export async function getDailyReview(
  potId: string,
  reviewDate: string,
): Promise<NutritionDailyReview | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_daily_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('review_date', '=', reviewDate)
    .executeTakeFirst();
  return row ? toDailyReview(row) : undefined;
}

export async function listDailyReviews(
  potId: string,
  limit = 30,
): Promise<NutritionDailyReview[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_daily_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('review_date', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toDailyReview);
}

// ── Weekly Check-Ins ──────────────────────────────────────────────────────

export interface UpsertWeeklyCheckInInput {
  weight?: number;
  weight_unit?: 'kg' | 'lbs';
  body_fat_pct?: number;
  rating?: number;
  notes?: string;
}

export async function upsertWeeklyCheckIn(
  potId: string,
  weekKey: string,
  data: UpsertWeeklyCheckInInput,
): Promise<NutritionWeeklyCheckIn> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_weekly_check_ins')
    .values({
      id,
      pot_id: potId,
      week_key: weekKey,
      weight: data.weight ?? null,
      weight_unit: data.weight_unit ?? null,
      body_fat_pct: data.body_fat_pct ?? null,
      rating: data.rating ?? null,
      notes: data.notes ?? null,
      submitted_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['pot_id', 'week_key']).doUpdateSet({
        weight: data.weight ?? null,
        weight_unit: data.weight_unit ?? null,
        body_fat_pct: data.body_fat_pct ?? null,
        rating: data.rating ?? null,
        notes: data.notes ?? null,
        submitted_at: now,
      }),
    )
    .execute();

  const row = await db
    .selectFrom('nutrition_weekly_check_ins')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('week_key', '=', weekKey)
    .executeTakeFirstOrThrow();

  return toWeeklyCheckIn(row);
}

export async function getWeeklyCheckIn(
  potId: string,
  weekKey: string,
): Promise<NutritionWeeklyCheckIn | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_weekly_check_ins')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('week_key', '=', weekKey)
    .executeTakeFirst();
  return row ? toWeeklyCheckIn(row) : undefined;
}

// ── Weekly Reviews ────────────────────────────────────────────────────────

export async function upsertWeeklyReview(
  potId: string,
  weekKey: string,
  checkInId: string | null,
  payload: Record<string, unknown>,
  modelId: string,
  promptVersion: string,
): Promise<NutritionWeeklyReview> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_weekly_reviews')
    .values({
      id,
      pot_id: potId,
      week_key: weekKey,
      check_in_id: checkInId,
      model_id: modelId,
      prompt_version: promptVersion,
      payload_json: JSON.stringify(payload),
      created_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['pot_id', 'week_key']).doUpdateSet({
        check_in_id: checkInId,
        model_id: modelId,
        prompt_version: promptVersion,
        payload_json: JSON.stringify(payload),
      }),
    )
    .execute();

  const row = await db
    .selectFrom('nutrition_weekly_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('week_key', '=', weekKey)
    .executeTakeFirstOrThrow();

  return toWeeklyReview(row);
}

export async function getWeeklyReview(
  potId: string,
  weekKey: string,
): Promise<NutritionWeeklyReview | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_weekly_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('week_key', '=', weekKey)
    .executeTakeFirst();
  return row ? toWeeklyReview(row) : undefined;
}

export async function listWeeklyReviews(
  potId: string,
  limit = 12,
): Promise<NutritionWeeklyReview[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_weekly_reviews')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('week_key', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toWeeklyReview);
}

// ── Recipes ───────────────────────────────────────────────────────────────

export async function createNutritionRecipe(
  input: CreateNutritionRecipeInput,
): Promise<NutritionRecipe> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_recipes')
    .values({
      id,
      pot_id: input.pot_id,
      title: input.title,
      category: input.category,
      cuisine_tags: JSON.stringify(input.cuisine_tags),
      key_ingredients: JSON.stringify(input.key_ingredients),
      flavor_profile: input.flavor_profile ?? null,
      meal_type_tags: JSON.stringify(input.meal_type_tags),
      full_recipe_json: JSON.stringify(input.full_recipe),
      feedback: null,
      generation_mode: input.generation_mode,
      source_prompt: input.source_prompt ?? null,
      model_id: input.model_id,
      prompt_version: input.prompt_version,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    title: input.title,
    category: input.category,
    cuisine_tags: input.cuisine_tags,
    key_ingredients: input.key_ingredients,
    flavor_profile: input.flavor_profile ?? null,
    meal_type_tags: input.meal_type_tags,
    full_recipe: input.full_recipe,
    feedback: null,
    generation_mode: input.generation_mode,
    source_prompt: input.source_prompt ?? null,
    model_id: input.model_id,
    prompt_version: input.prompt_version,
    created_at: now,
    updated_at: now,
  };
}

export async function getNutritionRecipe(id: string): Promise<NutritionRecipe | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_recipes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toNutritionRecipe(row) : undefined;
}

export async function setRecipeFeedback(
  id: string,
  feedback: 'liked' | 'disliked',
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('nutrition_recipes')
    .set({ feedback, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

export interface ListRecipesOptions {
  feedback?: 'liked' | 'disliked';
  category?: 'starter' | 'main' | 'dessert' | 'snack';
  limit?: number;
  offset?: number;
}

export async function listRecipes(
  potId: string,
  opts: ListRecipesOptions = {},
): Promise<{ recipes: NutritionRecipe[]; total: number }> {
  const db = getDatabase();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  let query = db.selectFrom('nutrition_recipes').where('pot_id', '=', potId);
  let countQuery = db.selectFrom('nutrition_recipes').where('pot_id', '=', potId);

  if (opts.feedback) {
    query = query.where('feedback', '=', opts.feedback);
    countQuery = countQuery.where('feedback', '=', opts.feedback);
  }
  if (opts.category) {
    query = query.where('category', '=', opts.category);
    countQuery = countQuery.where('category', '=', opts.category);
  }

  const [rows, countResult] = await Promise.all([
    query.selectAll().orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
    countQuery.select(db.fn.count<number>('id').as('count')).executeTakeFirst(),
  ]);

  return {
    recipes: rows.map(toNutritionRecipe),
    total: Number(countResult?.count ?? 0),
  };
}

// ── Pattern Analyses ──────────────────────────────────────────────────────

function toPatternAnalysis(row: any): NutritionPatternAnalysis {
  return {
    id: row.id,
    pot_id: row.pot_id,
    analysis_type: row.analysis_type,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    date_range_from: row.date_range_from,
    date_range_to: row.date_range_to,
    payload: JSON.parse(row.payload_json),
    triggered_by: row.triggered_by,
    created_at: row.created_at as number,
  };
}

export async function createPatternAnalysis(
  input: CreateNutritionPatternAnalysisInput,
): Promise<NutritionPatternAnalysis> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('nutrition_pattern_analyses')
    .values({
      id,
      pot_id: input.pot_id,
      analysis_type: input.analysis_type,
      model_id: input.model_id,
      prompt_version: input.prompt_version,
      date_range_from: input.date_range_from,
      date_range_to: input.date_range_to,
      payload_json: JSON.stringify(input.payload),
      triggered_by: input.triggered_by ?? 'manual',
      created_at: now,
    })
    .execute();

  return {
    id,
    pot_id: input.pot_id,
    analysis_type: input.analysis_type,
    model_id: input.model_id,
    prompt_version: input.prompt_version,
    date_range_from: input.date_range_from,
    date_range_to: input.date_range_to,
    payload: input.payload,
    triggered_by: input.triggered_by ?? 'manual',
    created_at: now,
  };
}

export async function listPatternAnalyses(
  potId: string,
  type?: 'food_symptom' | 'ingredient_sensitivity' | 'stack_review',
  limit = 20,
): Promise<NutritionPatternAnalysis[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('nutrition_pattern_analyses')
    .selectAll()
    .where('pot_id', '=', potId);
  if (type) {
    query = query.where('analysis_type', '=', type);
  }
  const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();
  return rows.map(toPatternAnalysis);
}

export async function getPatternAnalysis(id: string): Promise<NutritionPatternAnalysis | undefined> {
  const db = getDatabase();
  const row = await db
    .selectFrom('nutrition_pattern_analyses')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toPatternAnalysis(row) : undefined;
}

export async function searchRecipes(
  potId: string,
  query: string,
  limit = 20,
): Promise<NutritionRecipe[]> {
  const db = getDatabase();
  const term = `%${query.toLowerCase()}%`;
  const rows = await db
    .selectFrom('nutrition_recipes')
    .selectAll()
    .where('pot_id', '=', potId)
    .where((eb) =>
      eb.or([
        eb('title', 'like', term),
        eb('cuisine_tags', 'like', term),
        eb('key_ingredients', 'like', term),
      ]),
    )
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toNutritionRecipe);
}

export async function getLikedRecipeSummaries(
  potId: string,
  limit = 10,
): Promise<{ title: string; cuisine_tags: string[]; key_ingredients: string[]; category: string }[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_recipes')
    .select(['title', 'cuisine_tags', 'key_ingredients', 'category'])
    .where('pot_id', '=', potId)
    .where('feedback', '=', 'liked')
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    title: r.title,
    cuisine_tags: JSON.parse(r.cuisine_tags as string),
    key_ingredients: JSON.parse(r.key_ingredients as string),
    category: r.category,
  }));
}

export async function getDislikedRecipeSummaries(
  potId: string,
  limit = 10,
): Promise<{ title: string; cuisine_tags: string[]; key_ingredients: string[] }[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('nutrition_recipes')
    .select(['title', 'cuisine_tags', 'key_ingredients'])
    .where('pot_id', '=', potId)
    .where('feedback', '=', 'disliked')
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    title: r.title,
    cuisine_tags: JSON.parse(r.cuisine_tags as string),
    key_ingredients: JSON.parse(r.key_ingredients as string),
  }));
}
