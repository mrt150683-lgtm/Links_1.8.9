/**
 * Nutrition Module Schemas
 * Zod schemas for all AI outputs in the nutrition pipeline.
 * All schemas are strict (no extra keys pass through).
 */

import { z } from 'zod';

// ── Meal Analysis ─────────────────────────────────────────────────────────

export const MealIngredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.string().max(100),
  calories_estimate: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().optional(),
});

export const MealTotalsSchema = z.object({
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().optional(),
});

export const MealAnalysisArtifactSchema = z.object({
  meal_title: z.string().max(200),
  ingredients: z.array(MealIngredientSchema).max(50),
  totals: MealTotalsSchema,
  portion_confidence: z.enum(['high', 'medium', 'low']),
  image_quality: z.enum(['clear', 'partial', 'unclear']),
  allergens_detected: z.array(z.string()).max(20),
  uncertainty_notes: z.string().max(1000).optional(),
  disclaimer: z.literal('Estimates are approximate and not a substitute for laboratory analysis.'),
});

export type MealIngredient = z.infer<typeof MealIngredientSchema>;
export type MealTotals = z.infer<typeof MealTotalsSchema>;
export type MealAnalysisArtifact = z.infer<typeof MealAnalysisArtifactSchema>;

// ── Daily Review ──────────────────────────────────────────────────────────

export const DailyReviewPayloadSchema = z.object({
  review_date: z.string(),
  totals: MealTotalsSchema,
  nutritional_gaps: z.array(z.string()).max(10),
  highlights: z.array(z.string()).max(10),
  adherence_note: z.string().max(1000),
  confidence_note: z.string().max(500),
  low_confidence_meals_count: z.number().int().nonnegative(),
  disclaimer: z.literal('Estimates are approximate and not a substitute for laboratory analysis.'),
});

export type DailyReviewPayload = z.infer<typeof DailyReviewPayloadSchema>;

// ── Weekly Review ─────────────────────────────────────────────────────────

export const WeeklyReviewPayloadSchema = z.object({
  week_key: z.string(),
  what_went_well: z.array(z.string()).max(10),
  gap_areas: z.array(z.string()).max(10),
  practical_suggestions: z.array(z.string()).max(10),
  meals_worth_repeating: z.array(z.string()).max(10),
  underrepresented_nutrients: z.array(z.string()).max(10),
  suggested_recipe_directions: z.array(z.string()).max(5),
  overall_summary: z.string().max(2000),
  symptom_patterns: z.array(z.string()).max(3).optional(),
  supplement_notes: z.array(z.string()).max(2).optional(),
  disclaimer: z.literal('Estimates are approximate and not a substitute for laboratory analysis.'),
});

export type WeeklyReviewPayload = z.infer<typeof WeeklyReviewPayloadSchema>;

// ── Recipe Generation ─────────────────────────────────────────────────────

export const RecipePayloadSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(['starter', 'main', 'dessert', 'snack']),
  cuisine_tags: z.array(z.string()).max(10),
  key_ingredients: z.array(z.string()).max(20),
  flavor_profile: z.string().max(200).optional(),
  meal_type_tags: z.array(z.string()).max(5),
  prep_time_minutes: z.number().int().nonnegative().optional(),
  cook_time_minutes: z.number().int().nonnegative().optional(),
  servings: z.number().int().positive().optional(),
  instructions: z.array(z.string()).min(1).max(30),
  estimated_calories_per_serving: z.number().nonnegative().optional(),
  allergen_warnings: z.array(z.string()).max(20),
});

export const RecipeGenerationOutputSchema = z.object({
  recipes: z.array(RecipePayloadSchema).min(2).max(5),
});

export type RecipePayload = z.infer<typeof RecipePayloadSchema>;
export type RecipeGenerationOutput = z.infer<typeof RecipeGenerationOutputSchema>;

// ── Craving Assistant ─────────────────────────────────────────────────────

export const CravingAlternativeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  similarity_to_craving: z.enum(['closest', 'moderate', 'healthiest']),
  why_suggested: z.string().max(500),
  category: z.enum(['starter', 'main', 'dessert', 'snack']),
  cuisine_tags: z.array(z.string()).max(10),
  key_ingredients: z.array(z.string()).max(20),
  meal_type_tags: z.array(z.string()).max(5),
  instructions: z.array(z.string()).min(1).max(30),
  allergen_warnings: z.array(z.string()).max(20),
});

export const CravingAssistantOutputSchema = z.object({
  craving_interpreted_as: z.string().max(300),
  alternatives: z.array(CravingAlternativeSchema).min(2).max(5),
});

export type CravingAlternative = z.infer<typeof CravingAlternativeSchema>;
export type CravingAssistantOutput = z.infer<typeof CravingAssistantOutputSchema>;

// ── Pattern Analysis ──────────────────────────────────────────────────────

export const PatternFindingSchema = z.object({
  pattern: z.string().max(500),
  ingredient_or_food: z.string().max(200).optional(),
  related_symptoms: z.array(z.string().max(100)).max(10),
  frequency: z.string().max(200),
  confidence: z.enum(['possible', 'likely', 'consistent']),
  note: z.string().max(1000),
});

export const PatternAnalysisOutputSchema = z.object({
  analysis_type: z.enum(['food_symptom', 'ingredient_sensitivity']),
  date_range: z.string().max(100),
  findings: z.array(PatternFindingSchema).max(10),
  disclaimer: z.literal('Observations are pattern-based, not diagnostic. Consult a healthcare professional for medical advice.'),
});

export type PatternFinding = z.infer<typeof PatternFindingSchema>;
export type PatternAnalysisOutput = z.infer<typeof PatternAnalysisOutputSchema>;

// ── Stack Analysis ────────────────────────────────────────────────────────

export const StackFindingSchema = z.object({
  name: z.string().max(200),
  dose_logged: z.string().max(100).optional(),
  observation: z.string().max(500),
  flag_type: z.enum(['possible_overlap', 'possible_gap', 'worth_reviewing', 'ok']),
  note: z.string().max(1000),
});

export const StackAnalysisOutputSchema = z.object({
  supplements_reviewed: z.array(z.string().max(200)).max(50),
  findings: z.array(StackFindingSchema).max(20),
  overall_note: z.string().max(1000),
  disclaimer: z.literal('This is an informational pattern review, not medical advice.'),
});

export type StackFinding = z.infer<typeof StackFindingSchema>;
export type StackAnalysisOutput = z.infer<typeof StackAnalysisOutputSchema>;
