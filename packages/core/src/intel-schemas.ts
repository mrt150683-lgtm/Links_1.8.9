/**
 * Intel-Gen Schemas (Phase intel-gen)
 *
 * Zod schemas for validating AI responses from the Generated Intelligence pipeline.
 */

import { z } from 'zod';

// ============================================================================
// Question Generation Response Schema
// ============================================================================

export const IntelQuestionItemSchema = z.object({
  question: z.string().min(10).max(1000),
  entry_ids: z.array(z.string().uuid()).min(1),
  category: z
    .enum(['synthesis', 'contradiction_check', 'timeline', 'claim_validation', 'entity_profile', 'lead', 'other'])
    .optional()
    .default('other'),
  rationale: z.string().max(500).optional(),
});

export const IntelQuestionGenResponseSchema = z.object({
  questions: z.array(IntelQuestionItemSchema).max(100),
});

export type IntelQuestionItem = z.infer<typeof IntelQuestionItemSchema>;
export type IntelQuestionGenResponse = z.infer<typeof IntelQuestionGenResponseSchema>;

// ============================================================================
// Answer Response Schema
// ============================================================================

export const IntelAnswerEvidenceItemSchema = z.object({
  entry_id: z.string().uuid(),
  excerpt: z.string().min(1).max(2000),
  start_offset: z.number().int().nonnegative().optional(),
  end_offset: z.number().int().nonnegative().optional(),
});

export const IntelAnswerResponseSchema = z.object({
  answer: z.string().min(1).max(10000),
  confidence: z.number().min(0).max(1),
  evidence: z.array(IntelAnswerEvidenceItemSchema).min(0).max(20),
  limits: z.string().max(2000).nullable().optional(),
});

export type IntelAnswerEvidenceItem = z.infer<typeof IntelAnswerEvidenceItemSchema>;
export type IntelAnswerResponse = z.infer<typeof IntelAnswerResponseSchema>;
