/**
 * Self-Evolving Research Agent — Zod Schemas
 *
 * All request/response validation schemas for the agent module.
 * Migrations: 040–043
 */

import { z } from 'zod';

// ── Enum schemas ───────────────────────────────────────────────────────────

export const AgentModeSchema = z.enum(['quiet', 'balanced', 'bold']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const AgentCandidateTypeSchema = z.enum([
  'insight',
  'lead',
  'contradiction',
  'foreign_language_finding',
  'next_action',
  'tool_offer',
  'chat_seed',
  'search_prompt',
  'nutrition_correlation',
  'research_novelty',
  'journal_theme',
]);
export type AgentCandidateType = z.infer<typeof AgentCandidateTypeSchema>;

export const AgentCandidateStatusSchema = z.enum([
  'pending',
  'selected',
  'delivered',
  'snoozed',
  'archived',
  'rejected',
]);

export const AgentRunTypeSchema = z.enum([
  'heartbeat',
  'manual',
  'tool_build',
  'tool_test',
  'tool_run',
  'cross_pot_bridge',
]);

export const AgentRunStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled',
]);

export const AgentFeedbackActionSchema = z.enum([
  'cool',
  'meh',
  'undo',
  'known',
  'interested',
  'snooze',
  'useless',
  'approved_tool',
  'rejected_tool',
  'ran_tool',
  'disabled_tool',
  'opened_chat',
  'opened_search',
]);

export const AgentArtifactTypeSchema = z.enum([
  'agent_reflection',
  'agent_surprise',
  'agent_tool_build_report',
  'agent_tool_test_report',
  'agent_tool_logs',
  'agent_tool_output',
  'agent_snapshot_report',
]);

export const AgentToolStatusSchema = z.enum([
  'draft',
  'testing',
  'awaiting_approval',
  'active',
  'disabled',
  'rejected',
  'archived',
]);

export const AgentToolLanguageSchema = z.enum(['python', 'javascript']);

// ── Config schemas ─────────────────────────────────────────────────────────

export const CreateAgentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: AgentModeSchema.optional(),
  goal_text: z.string().max(2000).nullable().optional(),
  cross_pot_enabled: z.boolean().optional(),
  delivery_frequency: z.string().optional(),
  delivery_time_local: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  timezone: z.string().optional(),
  max_surprises_per_day: z.number().int().min(1).max(10).optional(),
  allow_tool_building: z.boolean().optional(),
  allow_auto_test_low_risk_tools: z.boolean().optional(),
  allow_auto_run_low_risk_tools: z.boolean().optional(),
  quiet_hours: z
    .object({ from: z.string(), to: z.string() })
    .nullable()
    .optional(),
});

export const UpdateAgentConfigSchema = CreateAgentConfigSchema;
export type CreateAgentConfigInput = z.infer<typeof CreateAgentConfigSchema>;

// ── Candidate list query ────────────────────────────────────────────────────

export const AgentCandidateListQuerySchema = z.object({
  status: AgentCandidateStatusSchema.optional(),
  candidate_type: AgentCandidateTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── Feedback request ────────────────────────────────────────────────────────

export const AgentFeedbackRequestSchema = z.object({
  action: AgentFeedbackActionSchema,
  snooze_hours: z.number().min(1).max(720).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Run list query ──────────────────────────────────────────────────────────

export const AgentRunListQuerySchema = z.object({
  status: AgentRunStatusSchema.optional(),
  run_type: AgentRunTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── Manual run trigger ──────────────────────────────────────────────────────

export const TriggerAgentRunSchema = z.object({
  run_type: AgentRunTypeSchema.optional().default('manual'),
});

// ── Tool feedback ───────────────────────────────────────────────────────────

export const AgentToolRunRequestSchema = z.object({
  input_payload: z.record(z.unknown()).optional().default({}),
  trigger_type: z.enum(['manual', 'user_retry']).optional().default('manual'),
});

// ── AI output schemas (validated after AI call) ─────────────────────────────

export const AgentReflectionCandidateSchema = z.object({
  candidate_type: AgentCandidateTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  evidence_score: z.number().min(0).max(1),
  source_refs: z.array(z.string()).default([]),
  launch_payload: z.record(z.unknown()).nullable().optional(),
});
export type AgentReflectionCandidate = z.infer<typeof AgentReflectionCandidateSchema>;

export const AgentReflectionAiOutputSchema = z.object({
  candidates: z.array(AgentReflectionCandidateSchema).min(0).max(12),
  digest_summary: z.string().optional(),
});
export type AgentReflectionAiOutput = z.infer<typeof AgentReflectionAiOutputSchema>;

export const AgentRankedCandidateSchema = z.object({
  title: z.string(),
  final_score: z.number().min(0).max(1),
  fatigue_score: z.number().min(0).max(1).optional(),
  cost_score: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
});

export const AgentRankingAiOutputSchema = z.object({
  ranked: z.array(AgentRankedCandidateSchema),
});
export type AgentRankingAiOutput = z.infer<typeof AgentRankingAiOutputSchema>;

export const AgentToolOpportunitySchema = z.object({
  detected: z.boolean(),
  workflow_name: z.string().optional(),
  workflow_description: z.string().optional(),
  evidence_snippets: z.array(z.string()).optional(),
  expected_language: z.enum(['python', 'javascript']).optional(),
  safety_class: z.enum(['low', 'medium', 'high']).optional(),
  utility_score: z.number().min(0).max(1).optional(),
});
export type AgentToolOpportunity = z.infer<typeof AgentToolOpportunitySchema>;

export const AgentToolSpecSchema = z.object({
  name: z.string().min(1).max(100),
  tool_key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  description: z.string().min(1).max(500),
  language: z.enum(['python', 'javascript']),
  capabilities_required: z.array(z.string()).default([]),
  input_schema: z.record(z.unknown()).default({}),
  output_schema: z.record(z.unknown()).default({}),
  sandbox_policy: z.object({
    max_wall_time_ms: z.number().max(30000).default(10000),
    max_memory_mb: z.number().max(256).default(64),
    max_output_bytes: z.number().max(1048576).default(102400),
    max_log_bytes: z.number().max(102400).default(10240),
    max_artifact_count: z.number().max(10).default(3),
    network_policy: z.enum(['none', 'approved_wrappers']).default('none'),
    file_policy: z.literal('none').default('none'),
  }).default({}),
  test_plan: z.array(z.string()).default([]),
  source_refs: z.array(z.string()).default([]),
});
export type AgentToolSpec = z.infer<typeof AgentToolSpecSchema>;

export const AgentToolCodeBundleSchema = z.object({
  main_code: z.string().min(1),
  helpers: z.array(z.object({ filename: z.string(), code: z.string() })).default([]),
  readme: z.string().optional(),
  bundle_size_estimate: z.number().optional(),
});
export type AgentToolCodeBundle = z.infer<typeof AgentToolCodeBundleSchema>;

export const AgentStaticCheckResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(z.object({
    rule: z.string(),
    line: z.number().optional(),
    detail: z.string(),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});
export type AgentStaticCheckResult = z.infer<typeof AgentStaticCheckResultSchema>;

export const AgentToolTestEvaluationSchema = z.object({
  passed: z.boolean(),
  quality_score: z.number().min(0).max(1),
  determinism_score: z.number().min(0).max(1).optional(),
  utility_score: z.number().min(0).max(1).optional(),
  issues: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  safety_class: z.enum(['low', 'medium', 'high']).default('medium'),
  approval_recommended: z.boolean(),
});
export type AgentToolTestEvaluation = z.infer<typeof AgentToolTestEvaluationSchema>;

export const AgentDecisionSchema = z.object({
  action: z.enum(['run_tool', 'build_tool', 'reflect_again', 'done']),
  tool_id: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
  rationale: z.string(),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
