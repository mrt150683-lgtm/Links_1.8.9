/**
 * API response types
 */

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  time: number;
  database: {
    connected: boolean;
    migration_version: number;
  };
  model_registry: {
    fetched_at: number;
    age_hours: number;
  };
}

export interface Pot {
  id: string;
  name: string;
  description: string | null;
  icon_emoji?: string | null;
  security_level?: string;
  created_at: number;
  updated_at: number;
  last_used_at: number;
}

export interface Entry {
  id: string;
  pot_id: string;
  type: 'text' | 'image' | 'doc' | 'link' | 'audio' | 'chat';
  content_text: string | null;
  content_sha256: string | null;
  capture_method: string;
  source_url: string | null;
  source_title: string | null;
  notes: string | null;
  captured_at: number;
  created_at: number;
  updated_at: number;
  client_capture_id: string | null;
  source_app: string | null;
  source_context: Record<string, unknown> | null;
  asset_id: string | null;
  link_url: string | null;
  link_title: string | null;
}

export interface ProcessingJob {
  id: string;
  pot_id: string | null;
  entry_id: string | null;
  entry_title: string | null;
  job_type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'canceled';
  priority: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface Tag {
  label: string;
  type: 'topic' | 'method' | 'domain' | 'sentiment' | 'other';
  confidence: number;
}

export interface TagsArtifact {
  tags: Tag[];
}

export type JournalKind = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface JournalEntry {
  id: string;
  kind: JournalKind;
  scope_type: 'pot' | 'global';
  scope_id: string | null;
  period_start_ymd: string;
  period_end_ymd: string;
  timezone: string;
  created_at: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  input_fingerprint: string;
  content: Record<string, unknown>;
  citations: unknown[];
}

export interface ProcessingConfig {
  journal?: {
    enabled: boolean;
    scopes?: { global?: boolean; pots?: boolean };
    daily?: { enabled?: boolean };
    rollups?: {
      weekly?: { enabled?: boolean };
      monthly?: { enabled?: boolean };
      quarterly?: { enabled?: boolean };
      yearly?: { enabled?: boolean };
    };
    models?: { journaling?: string };
  };
}

export interface LoggingPreferences {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface ExtractedTextArtifact {
  text: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface ArtifactResponse {
  id: string;
  pot_id: string;
  entry_id: string;
  artifact_type: 'tags' | 'entities' | 'summary' | 'extracted_text';
  schema_version: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number;
  created_at: number;
  payload: TagsArtifact | ExtractedTextArtifact;
  evidence: unknown;
}


export interface PlanningRun {
  id: string;
  pot_id: string;
  project_name: string;
  project_type: string;
  status: string;
  revision: number;
  approved_at: number | null;
  rejected_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface PlanningQuestion {
  id: string;
  question: string;
  why_it_matters: string;
  answer_type: 'text' | 'boolean' | 'choice' | 'multi_choice' | 'number';
  choices?: string[];
  required: boolean;
  allow_idk: boolean;
  allow_na: boolean;
}

export interface PlanningQuestionsPayload {
  project_type_guess: string;
  questions: PlanningQuestion[];
}

export interface PlanningFile {
  id: string;
  run_id: string;
  revision: number;
  path: string;
  kind: string;
  content_text: string | null;
  sha256: string;
  created_at: number;
}

// ============================================================================
// Deep Research Agent
// ============================================================================

export type ResearchRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ResearchRun {
  id: string;
  pot_id: string;
  status: ResearchRunStatus;
  goal_prompt: string;
  config: Record<string, unknown>;
  selected_model: string | null;
  plan_artifact_id: string | null;
  plan_approved_at: number | null;
  progress: Record<string, unknown>;
  budget_usage: Record<string, unknown>;
  previous_run_id: string | null;
  report_artifact_id: string | null;
  delta_artifact_id: string | null;
  novelty_artifact_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface ResearchArtifact {
  id: string;
  run_id: string;
  artifact_type: string;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface ResearchNotification {
  id: string;
  pot_id: string;
  run_id: string;
  type: string;
  message: string;
  read_at: number | null;
  created_at: number;
}

export interface ResearchSchedule {
  id: string;
  pot_id: string;
  enabled: boolean;
  cron_like: string | null;
  timezone: string;
  goal_prompt: string;
  auto_approve_plan: boolean;
  next_run_at: number | null;
}

export interface ResearchProgress {
  phase?: string;
  current_depth?: number;
  total_depth?: number;
  current_breadth?: number;
  total_breadth?: number;
  queries_completed?: number;
  queries_total?: number;
  entries_read?: number;
  pages_fetched?: number;
  learnings_count?: number;
  current_query?: string;
  message?: string;
}

// ============================================================================
// Scout & RepoForge
// ============================================================================

export interface ScoutPreferences {
  github_token_set: boolean;
  github_token_hint: string | null;
  default_model: string | null;
  default_days: number | null;
  default_stars: number | null;
  default_max_stars: number | null;
  default_top_n: number | null;
  default_language: string | null;
  default_include_forks: boolean | null;
}

export interface ScoutRunRow {
  run_id: string;
  created_at: string;
  args_json: string;
  git_sha: string | null;
  config_hash: string | null;
}

export interface ScoutStepRow {
  step_id: string;
  run_id: string;
  name: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  stats_json: string | null;
}

export interface ScoutBriefRow {
  brief_id: string;
  run_id: string;
  score: number;
  repo_ids_json: string;
  brief_json: string | null;
  brief_md: string | null;
  outreach_md: string | null;
  status: string;
  created_at: string;
}

export interface ForgeRunRow {
  run_id: string;
  mode: string;
  seed_text: string | null;
  seed_repo_full_name: string | null;
  created_at: string;
}

export interface ForgePackRow {
  pack_id: string;
  run_id: string;
  score: number;
  repo_ids_json: string;
  reasons_json: string | null;
  merge_plan_md: string | null;
  status: string;
  created_at: string;
}

// ── Entry Translations ────────────────────────────────────────────────────

export interface EntryTranslation {
  id: string;
  entry_id: string;
  target_language: string;
  target_language_code: string;
  translated_text: string;
  model_id: string;
  chunk_count: number;
  source_hash: string;
  created_at: number;
  updated_at: number;
}

export interface EntryTranslationSummary {
  target_language: string;
  target_language_code: string;
  created_at: number;
  updated_at: number;
}

export const SUPPORTED_TRANSLATION_LANGUAGES = [
  'Spanish',
  'French',
  'English (British)',
  'American English',
  'German',
  'Greek',
  'Portuguese',
  'Chinese (Simplified)',
  'Japanese',
  'Arabic',
  'Hebrew',
] as const;

export type SupportedTranslationLanguage = typeof SUPPORTED_TRANSLATION_LANGUAGES[number];
