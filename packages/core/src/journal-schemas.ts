/**
 * Journal Module: Zod schemas for AI output validation
 *
 * DailyNoteSchema  — validates daily note AI output
 * RollupNoteSchema — validates weekly/monthly/quarterly/yearly rollup AI output
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export const JournalCitationSchema = z.object({
  entry_id: z.string(),
  artifact_type: z.string().optional(),
  evidence: z
    .object({
      start: z.number().int().optional(),
      end: z.number().int().optional(),
      excerpt: z.string().max(1000).optional(),
    })
    .optional(),
});

export type JournalCitation = z.infer<typeof JournalCitationSchema>;

export const OpenLoopItemSchema = z.object({
  text: z.string().max(500),
  type: z.enum(['todo', 'question', 'decision', 'bug', 'research']),
  priority: z.enum(['low', 'med', 'high']),
  citations: z.array(JournalCitationSchema).max(10),
});

export type OpenLoopItem = z.infer<typeof OpenLoopItemSchema>;

export const WhatHappenedBulletSchema = z.object({
  bullet: z.string().max(500),
  citations: z.array(JournalCitationSchema).max(10),
});

export const KeyTagSchema = z.object({
  tag: z.string().max(100),
  count: z.number().int().nonnegative(),
});

export const KeyEntitySchema = z.object({
  entity: z.string().max(200),
  type: z.string().optional(),
  count: z.number().int().nonnegative(),
});

export const NotableSourceSchema = z.object({
  title: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  entry_id: z.string(),
  citations: z.array(JournalCitationSchema).max(5),
});

export const RelatedLinkSchema = z.object({
  link_id: z.string().optional(),
  src_entry_id: z.string(),
  dst_entry_id: z.string(),
  link_type: z.string(),
  confidence: z.number().min(0).max(1),
});

export const StatsSchema = z.object({
  entries_total: z.number().int().nonnegative(),
  entries_by_type: z.record(z.string(), z.number().int().nonnegative()),
  artifacts_by_type: z.record(z.string(), z.number().int().nonnegative()),
});

export const MissingArtifactSchema = z.object({
  detected_artifact_type: z.string(),
  note: z.string().max(500),
});

export const NextSuggestedActionSchema = z.object({
  suggestion: z.string().max(500),
  citations: z.array(JournalCitationSchema).max(5),
});

// ---------------------------------------------------------------------------
// Daily Note Schema
// ---------------------------------------------------------------------------

export const DailyNoteSchema = z.object({
  schema_version: z.literal(1),
  date_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.object({
    type: z.enum(['pot', 'global']),
    pot_id: z.string().optional(),
  }),
  headline: z.string().max(300),
  what_happened: z.array(WhatHappenedBulletSchema).max(50),
  open_loops: z.array(OpenLoopItemSchema).max(30),
  key_tags: z.array(KeyTagSchema).max(30),
  key_entities: z.array(KeyEntitySchema).max(30),
  notable_sources: z.array(NotableSourceSchema).max(20),
  related_links_graph: z.array(RelatedLinkSchema).max(30),
  stats: StatsSchema,
  missing_or_unhandled: z.array(MissingArtifactSchema).max(20),
  next_suggested_actions: z.array(NextSuggestedActionSchema).max(10),
});

export type DailyNote = z.infer<typeof DailyNoteSchema>;

// ---------------------------------------------------------------------------
// Rollup Citation (references journal_id, not entry_id)
// ---------------------------------------------------------------------------

export const RollupCitationSchema = z.object({
  journal_id: z.string(),
});

export type RollupCitation = z.infer<typeof RollupCitationSchema>;

const RollupHighlightSchema = z.object({
  bullet: z.string().max(500),
  citations: z.array(RollupCitationSchema).max(10),
});

const RollupThemeSchema = z.object({
  theme: z.string().max(200),
  evidence_days: z.array(z.string()).max(40),
  citations: z.array(RollupCitationSchema).max(10),
});

const OpenLoopRollupSchema = z.object({
  text: z.string().max(500),
  count: z.number().int().nonnegative(),
  citations: z.array(RollupCitationSchema).max(10),
});

const SuggestedTopicSchema = z.object({
  topic: z.string().max(300),
  why: z.string().max(500),
  citations: z.array(RollupCitationSchema).max(10),
});

const RollupInputsSchema = z.object({
  expected_children: z.number().int().nonnegative(),
  found_children: z.number().int().nonnegative(),
  child_kind: z.enum(['daily', 'weekly', 'monthly', 'quarterly']),
  child_journal_ids: z.array(z.string()).max(400),
});

// ---------------------------------------------------------------------------
// Rollup Note Schema (weekly / monthly / quarterly / yearly)
// ---------------------------------------------------------------------------

export const RollupNoteSchema = z.object({
  schema_version: z.literal(1),
  kind: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  period_start_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.object({
    type: z.enum(['pot', 'global']),
    pot_id: z.string().optional(),
  }),
  headline: z.string().max(300),
  highlights: z.array(RollupHighlightSchema).max(30),
  themes: z.array(RollupThemeSchema).max(20),
  open_loops_rollup: z.array(OpenLoopRollupSchema).max(30),
  suggested_topics: z.array(SuggestedTopicSchema).max(20),
  missing_or_unhandled: z.array(MissingArtifactSchema).max(20),
  inputs: RollupInputsSchema,
});

export type RollupNote = z.infer<typeof RollupNoteSchema>;

// ---------------------------------------------------------------------------
// Settings schemas (for PATCH /prefs/processing/journal)
// ---------------------------------------------------------------------------

export const JournalBudgetConfigSchema = z.object({
  max_entries_per_day: z.number().int().positive().optional(),
  max_chars_per_entry: z.number().int().positive().optional(),
  max_total_chars: z.number().int().positive().optional(),
  max_tokens_daily_job: z.number().int().positive().optional(),
  max_tokens_rollup_job: z.number().int().positive().optional(),
  max_jobs_per_startup_backfill: z.number().int().positive().optional(),
});

export const JournalConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  scopes: z
    .object({
      global: z.boolean().optional(),
      pots: z.boolean().optional(),
    })
    .optional(),
  daily: z
    .object({
      enabled: z.boolean().optional(),
      open_loops: z.boolean().optional(),
      time_local: z.string().optional(),
    })
    .optional(),
  rollups: z
    .object({
      weekly: z.object({ enabled: z.boolean().optional(), time_local: z.string().optional(), mode: z.string().optional() }).optional(),
      monthly: z.object({ enabled: z.boolean().optional(), time_local: z.string().optional() }).optional(),
      quarterly: z.object({ enabled: z.boolean().optional(), time_local: z.string().optional() }).optional(),
      yearly: z.object({ enabled: z.boolean().optional(), time_local: z.string().optional() }).optional(),
    })
    .optional(),
  budgets: JournalBudgetConfigSchema.optional(),
  models: z
    .object({
      daily_model: z.string().optional(),
      rollup_model: z.string().optional(),
    })
    .optional(),
  behavior: z
    .object({
      enqueue_prerequisites: z.boolean().optional(),
      allow_rollup_fallback_to_daily: z.boolean().optional(),
    })
    .optional(),
});

export type JournalConfigPatch = z.infer<typeof JournalConfigPatchSchema>;
