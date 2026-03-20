/**
 * MoM (Mixture of Models) Chat Orchestration Schemas
 *
 * Zod schemas for planner output, specialist agent output, and merge output.
 * All AI responses are validated against these before use.
 */

import { z } from 'zod';

// ── Planner Output ───────────────────────────────────────────────────

export const MomPlannerOutputSchema = z.object({
  should_use_mom: z.boolean(),
  execution_mode: z.enum(['single', 'mom_lite', 'mom_standard', 'mom_heavy']),
  recommended_agent_count: z.number().int().min(1).max(8),
  agent_roles: z.array(z.object({
    role: z.string(),
    description: z.string(),
    focus: z.string(),
  })),
  decomposition_strategy: z.string(),
  review_required: z.boolean(),
  merge_model_id: z.string().nullable().optional(),
  background_recommended: z.boolean(),
  reason: z.string(),
});

// ── Specialist Agent Output ──────────────────────────────────────────

export const MomAgentOutputSchema = z.object({
  role: z.string(),
  summary: z.string(),
  answer: z.string(),
  claims: z.array(z.string()),
  assumptions: z.array(z.string()),
  evidence_refs: z.array(z.string()),
  missing_context: z.array(z.string()),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

// ── Merge Output ─────────────────────────────────────────────────────

export const MomMergeOutputSchema = z.object({
  final_answer: z.string(),
  consensus_points: z.array(z.string()),
  disagreements: z.array(z.string()),
  rejected_claims: z.array(z.string()),
  missing_context: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  trace_summary: z.string(),
});

// ── Review Output (Phase 2) ──────────────────────────────────────────

export const MomReviewOutputSchema = z.object({
  target_agent_role: z.string(),
  verdict: z.enum(['accept', 'partial', 'reject']),
  supported_claims: z.array(z.string()),
  challenged_claims: z.array(z.string()),
  fabrications: z.array(z.string()),
  missing_perspectives: z.array(z.string()),
  suggested_additions: z.array(z.string()),
  confidence_delta: z.number().min(-1).max(1),
  notes: z.string(),
});

// ── Types ─────────────────────────────────────────────────────────────

export type MomPlannerOutput = z.infer<typeof MomPlannerOutputSchema>;
export type MomAgentOutput = z.infer<typeof MomAgentOutputSchema>;
export type MomMergeOutput = z.infer<typeof MomMergeOutputSchema>;
export type MomReviewOutput = z.infer<typeof MomReviewOutputSchema>;
