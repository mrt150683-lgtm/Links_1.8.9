/**
 * Deep Research Agent Schemas
 *
 * Zod schemas for all deep research agent types:
 * - Budget configuration and usage tracking
 * - Run config, progress, and checkpoint
 * - Artifact payloads (plan, report, delta, novelty, checkpoint)
 * - API request/response schemas
 * - Schedule config
 */

import { z } from 'zod';

// ============================================================================
// Budget
// ============================================================================

export const ResearchBudgetSchema = z.object({
  max_wall_time_ms: z.number().int().positive().default(1800000),   // 30 min
  max_model_tokens: z.number().int().positive().default(200000),
  max_cost_cents: z.number().positive().optional(),
  max_entries_read: z.number().int().positive().default(500),
  max_web_pages_fetched: z.number().int().nonnegative().default(0),
  max_total_sources: z.number().int().positive().default(100),
  max_depth: z.number().int().min(1).max(5).default(3),
  max_breadth: z.number().int().min(1).max(10).default(4),
  max_concurrency: z.number().int().min(1).max(5).default(2),
  max_links_per_run: z.number().int().positive().default(50),
});

export type ResearchBudget = z.infer<typeof ResearchBudgetSchema>;

// ============================================================================
// Run Config
// ============================================================================

// ============================================================================
// Escalator Config
// ============================================================================

export const EscalatorConfigSchema = z.object({
  target_candidates: z.number().int().min(1).default(10),
  min_external_sources: z.number().int().nonnegative().default(4),
  batch_size: z.number().int().min(1).max(20).default(6),
  max_sources_total: z.number().int().min(1).default(24),
  min_new_candidates_per_batch: z.number().int().min(0).default(2),
  max_low_yield_batches: z.number().int().min(1).default(2),
});

export type EscalatorConfig = z.infer<typeof EscalatorConfigSchema>;

export const ResearchRunConfigSchema = z.object({
  budget: ResearchBudgetSchema.default({}),
  web_augmentation_enabled: z.boolean().default(false),
  web_allowlist: z.array(z.string()).optional(),
  web_denylist: z.array(z.string()).optional(),
  auto_link_findings: z.boolean().default(true),
  novelty_threshold: z.number().min(0).max(1).default(0.3),
  contradiction_threshold: z.number().min(0).max(1).default(0.7),
  keyword_watchlist: z.array(z.string()).optional(),
  // Quality gates
  max_constraint_learnings: z.number().int().min(1).max(50).default(10),
  min_external_sources: z.number().int().nonnegative().default(0),
  topic_guard_enabled: z.boolean().default(true),
  topic_keywords: z.array(z.string()).optional(),
  require_evidence_for_learnings: z.boolean().default(true),
  // Escalator config (web path only)
  escalator: EscalatorConfigSchema.default({}),
  // Per-task model overrides. Falls back to run.selected_model, then AI prefs.
  model_overrides: z.object({
    plan: z.string().optional(),
    execute: z.string().optional(),
    delta: z.string().optional(),
    novelty: z.string().optional(),
  }).optional(),
});

export type ResearchRunConfig = z.infer<typeof ResearchRunConfigSchema>;

// ============================================================================
// Progress (persisted to DB for polling; kept small — no full learnings list)
// ============================================================================

export const RunProgressSchema = z.object({
  phase: z.enum(['planning', 'retrieving', 'processing', 'synthesizing', 'delta', 'novelty', 'linking', 'done']),
  current_depth: z.number().int(),
  total_depth: z.number().int(),
  current_breadth: z.number().int(),
  total_breadth: z.number().int(),
  queries_completed: z.number().int(),
  queries_total: z.number().int(),
  entries_read: z.number().int(),
  pages_fetched: z.number().int(),
  learnings_count: z.number().int(),
  current_query: z.string().optional(),
  message: z.string().optional(),
});

export type RunProgress = z.infer<typeof RunProgressSchema>;

// ============================================================================
// Budget Usage
// ============================================================================

export const BudgetUsageSchema = z.object({
  wall_time_ms: z.number().int().default(0),
  model_tokens: z.number().int().default(0),
  cost_cents: z.number().default(0),
  entries_read: z.number().int().default(0),
  web_pages_fetched: z.number().int().default(0),
  total_sources: z.number().int().default(0),
});

export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

// ============================================================================
// Checkpoint (light — IDs + stack only, NOT accumulated_learnings)
// ============================================================================

export const CheckpointLightSchema = z.object({
  depth_stack: z.array(z.object({
    depth: z.number().int(),
    pending_queries: z.array(z.string()),
    completed_queries: z.array(z.string()),
  })),
  visited_entry_ids: z.array(z.string().uuid()),
  visited_urls: z.array(z.string()),
  budget_usage: BudgetUsageSchema,
  checkpoint_artifact_id: z.string().uuid(),
  started_at: z.number().int(),
  current_phase: z.enum(['constraint', 'research']).default('constraint'),
  constraint_learnings_count: z.number().int().default(0),
  topic_keywords: z.array(z.string()).default([]),
  // Escalator state (all defaulted for backward compat with old checkpoints)
  escalator_batch_index: z.number().int().default(0),
  escalator_low_yield_count: z.number().int().default(0),
  escalator_candidates_total: z.number().int().default(0),
  escalator_sources_total: z.number().int().default(0),
  escalator_stage: z.number().int().min(0).max(3).default(0),
});

export type CheckpointLight = z.infer<typeof CheckpointLightSchema>;

// ============================================================================
// Artifact Payloads
// ============================================================================

export const ResearchPlanArtifactSchema = z.object({
  refined_goal: z.string(),
  assumptions: z.array(z.string()),
  sub_questions: z.array(z.string()),
  proposed_breadth: z.number().int(),
  proposed_depth: z.number().int(),
  web_augmentation: z.boolean(),
  data_scope: z.enum(['pot_only', 'pot_and_web']),
  estimated_entries_to_read: z.number().int(),
  estimated_tokens: z.number().int(),
  estimated_cost_cents: z.number().optional(),
  estimated_wall_time_ms: z.number().int(),
  pot_entry_count: z.number().int(),
  pot_summary: z.string().optional(),
});

export type ResearchPlanArtifact = z.infer<typeof ResearchPlanArtifactSchema>;

export const EvidenceExcerptSchema = z.object({
  entry_id: z.string().uuid(),
  start: z.number().int(),
  end: z.number().int(),
  excerpt: z.string(),
});

export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

// ============================================================================
// Learning Sources (typed provenance for each learning)
// ============================================================================

export const LearningSourceSchema = z.discriminatedUnion('source_type', [
  z.object({ source_type: z.literal('pot'), entry_id: z.string(), excerpt: z.string().max(500) }),
  z.object({ source_type: z.literal('web'), url: z.string(), excerpt: z.string().max(500) }),
  z.object({ source_type: z.literal('ingested'), entry_id: z.string(), url: z.string(), excerpt: z.string().max(500).optional() }),
]);

export type LearningSource = z.infer<typeof LearningSourceSchema>;

export const LearningSchema = z.object({
  text: z.string().max(1000),
  confidence: z.number().min(0).max(1),
  kind: z.enum(['constraint', 'research']).default('research'),
  sources: z.array(LearningSourceSchema).default([]),
  source_entry_ids: z.array(z.union([z.string(), z.number()]).transform(String)).default([]),
  source_urls: z.array(z.string()).optional(),
  evidence_excerpts: z.array(EvidenceExcerptSchema).optional(),
});

export type Learning = z.infer<typeof LearningSchema>;

/** Coerce a plain string into a minimal Learning object (AI sometimes returns string[] instead of Learning[]) */
const LearningCoercedSchema = z.union([
  LearningSchema,
  z.string().transform((s) => ({ text: s, confidence: 0.5, kind: 'research' as const, sources: [], source_entry_ids: [] as string[] })),
  // Fallback: malformed object (e.g. missing/undefined text field, wrong key names).
  // Extract text from common alternative field names before discarding.
  z.record(z.unknown()).transform((obj) => {
    const text =
      typeof obj['text'] === 'string' ? obj['text'] :
      typeof obj['content'] === 'string' ? obj['content'] :
      typeof obj['finding'] === 'string' ? obj['finding'] :
      typeof obj['description'] === 'string' ? obj['description'] :
      (Object.values(obj).find((v) => typeof v === 'string') as string | undefined) ?? '(unparseable learning)';
    return { text: text.substring(0, 1000), confidence: 0.5, kind: 'research' as const, sources: [], source_entry_ids: [] as string[] };
  }),
]);

export const ResearchReportArtifactSchema = z.object({
  title: z.string(),
  summary: z.union([z.string(), z.array(z.string()).transform((arr) => arr.join('\n'))]).pipe(z.string().max(2000)),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.union([z.string(), z.array(z.string()).transform((arr) => arr.join('\n'))]),
  })),
  learnings: z.array(LearningCoercedSchema),
  open_loops: z.array(z.string()),
  budget_hit: z.boolean(),
  entries_read_count: z.number().int(),
  sources_count: z.number().int(),
  insufficiency_reason: z.string().optional(),
  // Full provenance lists stored here (not in run row) to avoid row bloat
  entries_read_full: z.array(z.object({ id: z.string(), sha256: z.string() })).optional(),
  sources_ingested_full: z.array(z.object({ url: z.string(), sha256: z.string(), entry_id: z.string() })).optional(),
  generated_at: z.number().int(),
});

export type ResearchReportArtifact = z.infer<typeof ResearchReportArtifactSchema>;

// ============================================================================
// URL Triage Schemas (for escalator pre-filter AI call)
// ============================================================================

export const UrlTriageItemSchema = z.object({
  url: z.string(),
  relevant_to_topic: z.number().min(0).max(1),
  likely_2023_plus: z.number().min(0).max(1),
  source_type: z.enum(['paper', 'repo', 'lab', 'blog', 'other']),
});

export type UrlTriageItem = z.infer<typeof UrlTriageItemSchema>;

export const AiUrlTriageResponseSchema = z.object({
  results: z.array(UrlTriageItemSchema),
});

export type AiUrlTriageResponse = z.infer<typeof AiUrlTriageResponseSchema>;

// ============================================================================
// Rejection Tracking Schemas
// ============================================================================

export const RejectionSummarySchema = z.object({
  dropped_missing_evidence: z.number().int().default(0),
  dropped_not_2023_plus: z.number().int().default(0),
  dropped_topic_mismatch: z.number().int().default(0),
  dropped_duplicate: z.number().int().default(0),
  triage_rejected_low_relevance: z.number().int().default(0),
  triage_rejected_not_recent: z.number().int().default(0),
  total_urls_triaged: z.number().int().default(0),
  total_urls_ingested: z.number().int().default(0),
  total_candidates_extracted: z.number().int().default(0),
  total_candidates_accepted: z.number().int().default(0),
});

export type RejectionSummary = z.infer<typeof RejectionSummarySchema>;

export const SourceExtractionRecordSchema = z.object({
  source_id: z.string(),
  source_type: z.enum(['pot', 'web', 'ingested']),
  url: z.string().optional(),
  candidates_found: z.number().int().default(0),
  learnings_accepted: z.number().int().default(0),
  rejection_counts: z.record(z.string(), z.number().int()).default({}),
});

export type SourceExtractionRecord = z.infer<typeof SourceExtractionRecordSchema>;

// ============================================================================
// Blocked Artifact Schema
// ============================================================================

export const ResearchBlockedArtifactSchema = z.object({
  reason: z.enum(['INSUFFICIENT_SOURCES', 'INSUFFICIENT_CANDIDATES', 'BOTH']),
  sources_fetched: z.number().int(),
  triage_rejected_count: z.number().int(),
  candidates_count: z.number().int(),
  candidates_2023plus: z.number().int(),
  target_candidates: z.number().int(),
  min_external_sources: z.number().int(),
  top_rejection_reasons: z.array(z.object({
    reason: z.string(),
    count: z.number().int(),
  })).max(5),
  rejection_summary: RejectionSummarySchema,
  source_records: z.array(SourceExtractionRecordSchema).default([]),
  generated_at: z.number().int(),
});

export type ResearchBlockedArtifact = z.infer<typeof ResearchBlockedArtifactSchema>;

// ============================================================================
// Checkpoint Artifact (heavy — accumulated learnings + escalator tracking)
// ============================================================================

export const ResearchCheckpointArtifactSchema = z.object({
  accumulated_learnings: z.array(LearningSchema),
  entries_read_full: z.array(z.object({ id: z.string(), sha256: z.string() })),
  updated_at: z.number().int(),
  // Escalator tracking (defaulted for backward compat)
  source_extraction_records: z.array(SourceExtractionRecordSchema).default([]),
  rejection_summary: RejectionSummarySchema.default({}),
});

export type ResearchCheckpointArtifact = z.infer<typeof ResearchCheckpointArtifactSchema>;

export const ChangedFindingSchema = z.object({
  previous: LearningSchema,
  current: LearningSchema,
  change_type: z.enum(['updated', 'contradicted', 'reinforced']),
});

export const ResearchDeltaArtifactSchema = z.object({
  previous_run_id: z.string().uuid(),
  new_findings: z.array(LearningSchema),
  changed_findings: z.array(ChangedFindingSchema),
  removed_findings: z.array(LearningSchema),
  unresolved_questions: z.array(z.string()),
  summary: z.string(),
});

export type ResearchDeltaArtifact = z.infer<typeof ResearchDeltaArtifactSchema>;

export const ResearchNoveltyArtifactSchema = z.object({
  novelty_score: z.number().min(0).max(1),
  top_new_findings: z.array(z.object({
    finding: LearningSchema,
    novelty_reason: z.string(),
  })).max(10),
  contradictions: z.array(z.object({
    finding: LearningSchema,
    conflicts_with: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(10),
  keyword_matches: z.array(z.string()),
  alert_triggered: z.boolean(),
  alert_reasons: z.array(z.string()),
});

export type ResearchNoveltyArtifact = z.infer<typeof ResearchNoveltyArtifactSchema>;

// ============================================================================
// API Request Schemas
// ============================================================================

export const CreateResearchRunRequestSchema = z.object({
  goal_prompt: z.string().min(10).max(5000),
  config: ResearchRunConfigSchema.optional(),
  auto_approve_plan: z.boolean().default(false),
  selected_model: z.string().optional(),
});

export type CreateResearchRunRequest = z.infer<typeof CreateResearchRunRequestSchema>;

export const ApprovePlanRequestSchema = z.object({
  config_override: ResearchRunConfigSchema.partial().optional(),
});

export type ApprovePlanRequest = z.infer<typeof ApprovePlanRequestSchema>;

// ============================================================================
// Schedule Config
// ============================================================================

export const ResearchScheduleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  cron_like: z.string().optional(),   // "daily_at_09:00", "weekly_monday_09:00"
  timezone: z.string().default('UTC'),
  goal_prompt: z.string().min(10).max(5000),
  config: ResearchRunConfigSchema.optional(),
  auto_approve_plan: z.boolean().default(false),
});

export type ResearchScheduleConfig = z.infer<typeof ResearchScheduleConfigSchema>;

// ============================================================================
// AI response schemas (for job handlers to validate AI outputs)
// ============================================================================

export const AiResearchPlanResponseSchema = ResearchPlanArtifactSchema;

export const AiQueryGenerationResponseSchema = z.object({
  queries: z.array(z.string().min(1).max(500)).min(1).max(10),
  follow_up_questions: z.array(z.string()).optional(),
});

export type AiQueryGenerationResponse = z.infer<typeof AiQueryGenerationResponseSchema>;

export const AiLearningExtractionResponseSchema = z.object({
  learnings: z.array(LearningSchema).max(20),
});

export type AiLearningExtractionResponse = z.infer<typeof AiLearningExtractionResponseSchema>;

export const AiReportSynthesisResponseSchema = ResearchReportArtifactSchema;

export const AiDeltaComputationResponseSchema = z.object({
  new_findings: z.array(LearningSchema),
  changed_findings: z.array(ChangedFindingSchema),
  removed_findings: z.array(LearningSchema),
  unresolved_questions: z.array(z.string()),
  summary: z.string(),
});

export type AiDeltaComputationResponse = z.infer<typeof AiDeltaComputationResponseSchema>;

export const AiNoveltyResponseSchema = ResearchNoveltyArtifactSchema;

// ============================================================================
// Search Candidates Artifact (raw web search results before triage)
// ============================================================================

export const RawSearchCandidateSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  source_engine: z.enum(['duckduckgo', 'arxiv', 'other']),
  query: z.string(),
});

export const ResearchSearchCandidatesArtifactSchema = z.object({
  batch_index: z.number().int(),
  queries: z.array(z.string()),
  total_raw: z.number().int(),
  total_after_dedup: z.number().int(),
  candidates: z.array(RawSearchCandidateSchema),
  generated_at: z.number().int(),
});

export type RawSearchCandidate = z.infer<typeof RawSearchCandidateSchema>;
export type ResearchSearchCandidatesArtifact = z.infer<typeof ResearchSearchCandidatesArtifactSchema>;
