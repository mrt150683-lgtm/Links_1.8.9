/**
 * Automation & Heartbeat Schemas
 *
 * Zod schemas for the modular automation subsystem:
 * - PotAutomationSettings
 * - ScheduledTask / TaskRun
 * - HeartbeatSnapshot / HeartbeatDocument
 * - HeartbeatOutputSchema (AI output contract)
 */

import { z } from 'zod';

// ── Quiet hours ────────────────────────────────────────────────────────────

export const QuietHoursSchema = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
  to: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

// ── Run window ─────────────────────────────────────────────────────────────

export const RunWindowSchema = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)).optional(),
});
export type RunWindow = z.infer<typeof RunWindowSchema>;

// ── Token budget ───────────────────────────────────────────────────────────

export const TokenBudgetSchema = z.object({
  max_input_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_cost_usd_per_run: z.number().positive().optional(),
});
export type TokenBudget = z.infer<typeof TokenBudgetSchema>;

// ── Automation preferences (global) ───────────────────────────────────────

export const AutomationPrefsSchema = z.object({
  enabled: z.boolean().optional(),
  default_model: z.string().optional(),
  timezone: z.string().optional(),
  quiet_hours: QuietHoursSchema.optional(),
  max_heartbeat_runs_per_day: z.number().int().positive().optional(),
  max_tasks_created_per_day: z.number().int().positive().optional(),
  proactive_main_chat_enabled: z.boolean().optional(),
  proactive_main_chat_model: z.string().optional(),
});
export type AutomationPrefs = z.infer<typeof AutomationPrefsSchema>;

// ── Pot automation settings ────────────────────────────────────────────────

export const PotAutomationSettingsSchema = z.object({
  id: z.string(),
  pot_id: z.string(),
  enabled: z.boolean(),
  heartbeat_enabled: z.boolean(),
  agent_task_management_enabled: z.boolean(),
  agent_can_create_tasks: z.boolean(),
  agent_can_update_tasks: z.boolean(),
  agent_can_complete_tasks: z.boolean(),
  agent_can_render_heartbeat_md: z.boolean(),
  default_model: z.string().nullable(),
  timezone: z.string(),
  quiet_hours: QuietHoursSchema.nullable(),
  run_windows: z.array(RunWindowSchema).nullable(),
  token_budget: TokenBudgetSchema.nullable(),
  max_tasks_created_per_day: z.number().int(),
  max_heartbeat_runs_per_day: z.number().int(),
  proactive_conversations_enabled: z.boolean(),
  proactive_conversation_model: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type PotAutomationSettings = z.infer<typeof PotAutomationSettingsSchema>;

export const UpsertAutomationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  heartbeat_enabled: z.boolean().optional(),
  agent_task_management_enabled: z.boolean().optional(),
  agent_can_create_tasks: z.boolean().optional(),
  agent_can_update_tasks: z.boolean().optional(),
  agent_can_complete_tasks: z.boolean().optional(),
  agent_can_render_heartbeat_md: z.boolean().optional(),
  default_model: z.string().nullable().optional(),
  timezone: z.string().optional(),
  quiet_hours: QuietHoursSchema.nullable().optional(),
  run_windows: z.array(RunWindowSchema).nullable().optional(),
  token_budget: TokenBudgetSchema.nullable().optional(),
  max_tasks_created_per_day: z.number().int().positive().optional(),
  max_heartbeat_runs_per_day: z.number().int().positive().optional(),
  proactive_conversations_enabled: z.boolean().optional(),
  proactive_conversation_model: z.string().nullable().optional(),
});
export type UpsertAutomationSettings = z.infer<typeof UpsertAutomationSettingsSchema>;

// ── Scheduled task ─────────────────────────────────────────────────────────

export const ScheduledTaskStatusSchema = z.enum(['active', 'paused', 'completed', 'canceled']);
export type ScheduledTaskStatus = z.infer<typeof ScheduledTaskStatusSchema>;

export const ScheduleKindSchema = z.enum(['cron', 'once', 'manual', 'event']);
export type ScheduleKind = z.infer<typeof ScheduleKindSchema>;

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  pot_id: z.string(),
  task_type: z.string(),
  title: z.string(),
  description: z.string(),
  status: ScheduledTaskStatusSchema,
  schedule_kind: ScheduleKindSchema,
  cron_like: z.string().nullable(),
  run_at: z.number().int().nullable(),
  timezone: z.string(),
  payload: z.record(z.unknown()),
  created_by: z.enum(['user', 'system', 'agent']),
  created_from: z.enum(['chat', 'settings', 'automation', 'migration']),
  last_run_at: z.number().int().nullable(),
  next_run_at: z.number().int().nullable(),
  last_result_status: z.string().nullable(),
  last_result_summary: z.string().nullable(),
  priority: z.number().int(),
  locked_by: z.string().nullable(),
  locked_at: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ScheduledTaskCreateSchema = z.object({
  pot_id: z.string(),
  task_type: z.string().default('custom_prompt_task'),
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  status: ScheduledTaskStatusSchema.optional().default('active'),
  schedule_kind: ScheduleKindSchema.default('manual'),
  cron_like: z.string().nullable().optional(),
  run_at: z.number().int().nullable().optional(),
  timezone: z.string().optional().default('UTC'),
  payload: z.record(z.unknown()).optional().default({}),
  created_by: z.enum(['user', 'system', 'agent']).optional().default('user'),
  created_from: z.enum(['chat', 'settings', 'automation', 'migration']).optional().default('settings'),
  priority: z.number().int().min(1).max(100).optional().default(10),
});
export type ScheduledTaskCreate = z.infer<typeof ScheduledTaskCreateSchema>;

export const ScheduledTaskUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: ScheduledTaskStatusSchema.optional(),
  schedule_kind: ScheduleKindSchema.optional(),
  cron_like: z.string().nullable().optional(),
  run_at: z.number().int().nullable().optional(),
  timezone: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  next_run_at: z.number().int().nullable().optional(),
});
export type ScheduledTaskUpdate = z.infer<typeof ScheduledTaskUpdateSchema>;

// ── Task run ───────────────────────────────────────────────────────────────

export const TaskRunSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  pot_id: z.string(),
  job_id: z.string().nullable(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  started_at: z.number().int().nullable(),
  finished_at: z.number().int().nullable(),
  model_id: z.string().nullable(),
  prompt_id: z.string().nullable(),
  prompt_version: z.string().nullable(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_estimate: z.number(),
  result: z.unknown().nullable(),
  error_text: z.string().nullable(),
  created_at: z.number().int(),
});
export type TaskRun = z.infer<typeof TaskRunSchema>;

// ── Heartbeat snapshot ─────────────────────────────────────────────────────

export const HeartbeatSnapshotSchema = z.object({
  id: z.string(),
  pot_id: z.string(),
  period_key: z.string(),
  snapshot: z.record(z.unknown()),
  summary: z.record(z.unknown()),
  open_loops: z.array(z.unknown()),
  proposed_tasks: z.array(z.unknown()),
  model_id: z.string().nullable(),
  prompt_id: z.string().nullable(),
  prompt_version: z.string().nullable(),
  role_hash: z.string().nullable(),
  input_fingerprint: z.string().nullable(),
  created_at: z.number().int(),
});
export type HeartbeatSnapshot = z.infer<typeof HeartbeatSnapshotSchema>;

// ── Heartbeat document ─────────────────────────────────────────────────────

export const HeartbeatDocumentSchema = z.object({
  id: z.string(),
  pot_id: z.string(),
  heartbeat_snapshot_id: z.string(),
  format: z.string(),
  content_text: z.string(),
  content_sha256: z.string().nullable(),
  storage_mode: z.enum(['db', 'file', 'both']),
  file_path: z.string().nullable(),
  created_at: z.number().int(),
});
export type HeartbeatDocument = z.infer<typeof HeartbeatDocumentSchema>;

// ── Heartbeat AI output (strict contract) ─────────────────────────────────

export const HeartbeatOpenLoopSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  source_refs: z.array(z.string()).optional().default([]),
});
export type HeartbeatOpenLoop = z.infer<typeof HeartbeatOpenLoopSchema>;

export const HeartbeatRiskSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional().default('medium'),
});
export type HeartbeatRisk = z.infer<typeof HeartbeatRiskSchema>;

export const HeartbeatRecommendedActionSchema = z.object({
  action: z.string(),
  rationale: z.string(),
  urgency: z.enum(['immediate', 'soon', 'eventually']).optional().default('soon'),
});
export type HeartbeatRecommendedAction = z.infer<typeof HeartbeatRecommendedActionSchema>;

export const HeartbeatTaskOpSchema = z.object({
  title: z.string(),
  description: z.string().optional().default(''),
  task_type: z.string().optional().default('custom_prompt_task'),
  schedule_kind: ScheduleKindSchema.optional().default('manual'),
  cron_like: z.string().optional(),
  priority: z.number().int().min(1).max(100).optional().default(10),
});
export type HeartbeatTaskOp = z.infer<typeof HeartbeatTaskOpSchema>;

export const HeartbeatTaskOperationsSchema = z.object({
  create: z.array(HeartbeatTaskOpSchema).optional().default([]),
  update: z.array(z.object({
    task_id: z.string(),
    patch: ScheduledTaskUpdateSchema,
  })).optional().default([]),
  complete: z.array(z.string()).optional().default([]),
  pause: z.array(z.string()).optional().default([]),
});
export type HeartbeatTaskOperations = z.infer<typeof HeartbeatTaskOperationsSchema>;

export const HeartbeatMarkdownSectionSchema = z.object({
  heading: z.string(),
  content: z.string(),
});
export type HeartbeatMarkdownSection = z.infer<typeof HeartbeatMarkdownSectionSchema>;

export const HeartbeatOutputSchema = z.object({
  headline: z.string().max(200),
  summary: z.string().max(1000),
  what_changed: z.string().max(500),
  open_loops: z.array(HeartbeatOpenLoopSchema).max(10),
  risks: z.array(HeartbeatRiskSchema).max(5),
  recommended_actions: z.array(HeartbeatRecommendedActionSchema).max(5),
  task_operations: HeartbeatTaskOperationsSchema.optional().default({
    create: [], update: [], complete: [], pause: [],
  }),
  heartbeat_markdown_sections: z.array(HeartbeatMarkdownSectionSchema).optional().default([]),
  confidence: z.number().min(0).max(1),
  reasoning_basis: z.string().max(500),
});
export type HeartbeatOutput = z.infer<typeof HeartbeatOutputSchema>;
