/**
 * DYK Engine Schemas (030_dyk)
 *
 * Zod schemas for:
 *  - AI output validation (DykAiOutputSchema)
 *  - API request validation (DykFeedbackRequestSchema, DykListQuerySchema)
 *  - Onboarding (OnboardingCompleteRequestSchema, PotSettingsUpdateSchema)
 */

import { z } from 'zod';

// ── AI Output ────────────────────────────────────────────────────────────────

export const DykAiEvidenceSchema = z.object({
  entry_id: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  excerpt: z.string().min(1).max(500),
});

export const DykAiItemSchema = z.object({
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(1000),
  keywords: z.array(z.string().min(1).max(60)).min(2).max(10),
  confidence: z.number().min(0).max(1),
  novelty_hint: z.number().min(0).max(1).optional(),
  why_relevant: z.string().max(300).optional(),
  source_evidence: z.array(DykAiEvidenceSchema).max(6),
});

export const DykAiOutputSchema = z.object({
  items: z.array(DykAiItemSchema).min(1).max(8),
});

export type DykAiEvidence = z.infer<typeof DykAiEvidenceSchema>;
export type DykAiItem = z.infer<typeof DykAiItemSchema>;
export type DykAiOutput = z.infer<typeof DykAiOutputSchema>;

// ── API Request Schemas ───────────────────────────────────────────────────────

export const DYK_FEEDBACK_ACTIONS = ['known', 'interested', 'snooze', 'useless', 'opened_chat', 'opened_search'] as const;

export const DykFeedbackRequestSchema = z.object({
  action: z.enum(DYK_FEEDBACK_ACTIONS),
  snooze_hours: z.number().int().min(1).max(168).optional(), // 1h – 7d
  engine_id: z.string().optional(),
});

export const DykListQuerySchema = z.object({
  status: z.enum(['new', 'queued', 'shown', 'known', 'interested', 'snoozed', 'useless', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  min_novelty: z.coerce.number().min(0).max(1).optional(),
});

export type DykFeedbackRequest = z.infer<typeof DykFeedbackRequestSchema>;
export type DykListQuery = z.infer<typeof DykListQuerySchema>;

// ── Onboarding Schemas ────────────────────────────────────────────────────────

export const OnboardingCompleteRequestSchema = z.object({
  goal_text: z.string().min(1).max(2000),
  role_ref: z.string().optional(),
  search_targets: z.array(z.string()).min(0).max(30),
});

export const PotSettingsUpdateSchema = z.object({
  goal_text: z.string().min(1).max(2000).optional(),
  role_ref: z.string().optional().nullable(),
  search_targets: z.array(z.string()).optional(),
  dyk_interval_hours: z.number().int().min(1).max(168).optional(),
});

export type OnboardingCompleteRequest = z.infer<typeof OnboardingCompleteRequestSchema>;
export type PotSettingsUpdate = z.infer<typeof PotSettingsUpdateSchema>;
