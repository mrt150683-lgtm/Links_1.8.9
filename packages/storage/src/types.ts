import type { ColumnType } from 'kysely';

/**
 * Database schema types for Kysely
 */

export interface PotsTable {
  id: string;
  name: string;
  description: string | null;
  security_level: string;
  created_at: ColumnType<number, number, never>; // readonly after insert
  updated_at: number;
  last_used_at: number | null; // Phase 3: for popup sorting
  // Agent roles (018_pot_role)
  role_ref: string | null;
  role_hash: string | null;
  role_updated_at: number | null;
  // DYK feature (030_dyk)
  goal_text: string | null;
  search_targets_json: string | null;
  dyk_state_json: string | null;
}

export interface EntriesTable {
  id: string;
  pot_id: string;
  type: 'text' | 'image' | 'doc' | 'link' | 'audio' | 'chat';
  content_text: string;
  content_sha256: string;
  capture_method: string;
  source_url: string | null;
  source_title: string | null;
  notes: string | null;
  captured_at: number;
  created_at: ColumnType<number, number, never>; // readonly after insert
  updated_at: number;
  // Phase 3: idempotency and metadata
  client_capture_id: string | null;
  source_app: string | null;
  source_context_json: string | null;
  // Phase 4: asset reference
  asset_id: string | null;
  // Phase 11: link-specific fields
  link_url: string | null;
  link_title: string | null;
}

export interface AssetsTable {
  id: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename: string | null;
  storage_path: string;
  encryption_version: number;
  created_at: ColumnType<number, number, never>; // readonly after insert
}

export interface AuditEventsTable {
  id: string;
  timestamp: number;
  actor: 'user' | 'system' | 'extension';
  action: string;
  pot_id: string | null;
  entry_id: string | null;
  metadata_json: string;
  // flow correlation (031_flow_correlation)
  job_id: string | null;
}

export interface MigrationsTable {
  id: number;
  name: string;
  applied_at: number;
}

export interface UserPrefsTable {
  key: string;
  value_json: string;
}

export interface ProcessingJobsTable {
  id: string;
  pot_id: string | null;
  entry_id: string | null;
  job_type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'canceled';
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: number;
  locked_by: string | null;
  locked_at: number | null;
  last_error: string | null;
  payload_json: string | null; // Journal module: structured job payload
  // flow correlation (031_flow_correlation)
  flow_id: string | null;
  created_at: ColumnType<number, number, never>; // readonly after insert
  updated_at: number;
}

export interface JobLogsTable {
  id: string;
  job_id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  data_json: string;
}

export interface AiModelsTable {
  id: string;
  name: string;
  context_length: number;
  pricing_prompt: number | null;
  pricing_completion: number | null;
  supports_vision: number;
  supports_tools: number;
  architecture: string | null;
  modalities: string | null;
  top_provider: string | null;
  fetched_at: number;
  created_at: ColumnType<number, number, never>; // readonly after insert
}

export interface DerivedArtifactsTable {
  id: string;
  pot_id: string;
  entry_id: string;
  artifact_type: 'tags' | 'entities' | 'summary' | 'extracted_text' | 'date_mentions';
  schema_version: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  created_at: ColumnType<number, number, never>; // readonly after insert
  payload_json: string;
  evidence_json: string | null;
  // Agent roles (018_pot_role): provenance — which role generated this artifact
  role_hash: string | null;
}

export interface LinkCandidatesTable {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  reason: string;
  score: number;
  status: 'new' | 'processing' | 'processed' | 'skipped';
  created_at: ColumnType<number, number, never>; // readonly after insert
}

export interface LinksTable {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  link_type: 'same_topic' | 'same_entity' | 'supports' | 'contradicts' | 'references' | 'sequence' | 'duplicate' | 'other';
  confidence: number;
  rationale: string;
  evidence_json: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  created_at: ColumnType<number, number, never>; // readonly after insert
}

// ============================================================================
// Intelligence Gen Tables (Phase intel-gen)
// ============================================================================

export interface IntelligenceRunsTable {
  id: string;
  pot_id: string;
  mode: 'full' | 'digest';
  model_id: string;
  prompt_version: string;
  pot_snapshot_hash: string;
  estimated_input_tokens: number;
  context_length: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  error_message: string | null;
  custom_prompt: string | null;
  max_questions: number;
  created_at: ColumnType<number, number, never>;
  finished_at: number | null;
}

export interface IntelligenceQuestionsTable {
  id: string;
  run_id: string;
  pot_id: string;
  question_signature: string;
  question_text: string;
  entry_ids_json: string;
  category: 'synthesis' | 'contradiction_check' | 'timeline' | 'claim_validation' | 'entity_profile' | 'lead' | 'other' | null;
  rationale: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  created_at: ColumnType<number, number, never>;
}

export interface IntelligenceAnswersTable {
  id: string;
  question_id: string;
  pot_id: string;
  answer_text: string;
  confidence: number;
  evidence_json: string;
  excerpt_validation: 'pass' | 'fail';
  excerpt_validation_details: string | null;
  limits_text: string | null;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  token_usage_json: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface IntelligenceKnownQuestionsTable {
  id: string;
  pot_id: string;
  pot_snapshot_hash: string | null;
  question_signature: string;
  last_question_id: string | null;
  first_seen_at: number;
  last_seen_at: number;
  times_seen: number;
}

export interface JournalEntriesTable {
  id: string;
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  scope_type: 'pot' | 'global';
  scope_id: string | null;
  period_start_ymd: string;
  period_end_ymd: string;
  timezone: string;
  created_at: ColumnType<number, number, never>; // readonly after insert
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  input_fingerprint: string;
  content_json: string;
  citations_json: string;
}

export interface PlanningRunsTable {
  id: string;
  pot_id: string;
  project_name: string;
  project_type: string;
  status: 'draft' | 'questions_generated' | 'answers_recorded' | 'plan_generated' | 'approved' | 'rejected' | 'phases_generated' | 'docs_generated' | 'exported' | 'failed';
  revision: number;
  approved_at: number | null;
  rejected_reason: string | null;
  model_profile_json: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface PlanningAnswersTable {
  id: string;
  run_id: string;
  revision: number;
  answers_json: string;
  created_at: ColumnType<number, number, never>;
}

export interface PlanningFilesTable {
  id: string;
  run_id: string;
  revision: number;
  path: string;
  kind: string;
  content_text: string | null;
  asset_id: string | null;
  sha256: string;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  temperature: number | null;
  max_tokens: number | null;
  created_at: ColumnType<number, number, never>;
}

// ============================================================================
// Deep Research Tables (021_deep_research)
// ============================================================================

export interface ResearchArtifactsTable {
  id: string;
  run_id: string;
  artifact_type: 'research_plan' | 'research_report' | 'research_delta' | 'research_novelty' | 'research_checkpoint' | 'research_blocked' | 'research_rejection_summary' | 'research_search_candidates';
  schema_version: number;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  temperature: number | null;
  payload_json: string;
  created_at: ColumnType<number, number, never>;
}

export interface ResearchRunsTable {
  id: string;
  pot_id: string;
  status: 'draft' | 'planning' | 'awaiting_approval' | 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled' | 'blocked';
  goal_prompt: string;
  config_json: string;
  selected_model: string | null;
  model_overrides_json: string | null;
  plan_artifact_id: string | null;
  plan_approved_at: number | null;
  plan_approved_by: string | null;
  checkpoint_artifact_id: string | null;
  checkpoint_json: string | null;
  progress_json: string;
  budget_usage_json: string;
  previous_run_id: string | null;
  model_id: string | null;
  prompt_ids_json: string | null;
  entries_read_json: string | null;
  sources_ingested_json: string | null;
  report_artifact_id: string | null;
  delta_artifact_id: string | null;
  novelty_artifact_id: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface ResearchSchedulesTable {
  id: string;
  pot_id: string;
  enabled: number; // 0 | 1 (SQLite STRICT boolean)
  cron_like: string | null;
  timezone: string;
  goal_prompt: string;
  config_json: string;
  auto_approve_plan: number; // 0 | 1
  last_run_id: string | null;
  next_run_at: number | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface ResearchNotificationsTable {
  id: string;
  pot_id: string;
  run_id: string;
  type: 'novelty_threshold' | 'contradiction_threshold' | 'keyword_match';
  message: string;
  metadata_json: string;
  read_at: number | null;
  created_at: ColumnType<number, number, never>;
}

// ============================================================================
// Chat Tables (024_chat_tables)
// ============================================================================

export interface ChatThreadsTable {
  id: string;
  pot_id: string;
  title: string | null;
  model_id: string | null;
  personality_prompt_hash: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface ChatMessagesTable {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations_json: string | null;
  token_usage_json: string | null;
  model_id: string | null;
  created_at: ColumnType<number, number, never>;
}

// ============================================================================
// MainChat Tables (026_main_chat + 027_main_chat_notifications)
// ============================================================================

export interface MainChatThreadsTable {
  id: ColumnType<string, string, never>;
  title: ColumnType<string | null, string | null, string | null>;
  model_id: ColumnType<string | null, string | null, string | null>;
  created_at: ColumnType<number, number, never>;
  updated_at: ColumnType<number, number, number>;
}

export interface MainChatMessagesTable {
  id: ColumnType<string, string, never>;
  thread_id: ColumnType<string, string, never>;
  role: ColumnType<string, string, never>;
  content: ColumnType<string, string, string>;
  citations_json: ColumnType<string | null, string | null, string | null>;
  token_usage_json: ColumnType<string | null, string | null, string | null>;
  model_id: ColumnType<string | null, string | null, string | null>;
  created_at: ColumnType<number, number, never>;
}

export type MainChatNotificationType = 'greeting' | 'triage' | 'insight' | 'goal_aligned' | 'reminder' | 'system' | 'digest' | 'conversation';
export type MainChatNotificationState = 'unread' | 'opened' | 'dismissed' | 'snoozed' | 'expired';

export interface MainChatNotificationsTable {
  id: ColumnType<string, string, never>;
  type: ColumnType<MainChatNotificationType, MainChatNotificationType, never>;
  title: ColumnType<string, string, never>;
  preview: ColumnType<string | null, string | null, string | null>;
  payload_json: ColumnType<string | null, string | null, string | null>;
  state: ColumnType<MainChatNotificationState, MainChatNotificationState, MainChatNotificationState>;
  snoozed_until: ColumnType<number | null, number | null, number | null>;
  read_at: ColumnType<number | null, number | null, number | null>;
  created_at: ColumnType<number, number, never>;
  // flow correlation (032_flow_runs)
  flow_id: ColumnType<string | null, string | null, string | null>;
}

// ============================================================================
// Flow Runs Table (032_flow_runs)
// ============================================================================

export interface FlowRunsTable {
  id: string;
  flow_type: string;
  status: 'started' | 'completed' | 'failed' | 'partial';
  pot_id: string | null;
  entry_id: string | null;
  started_at: ColumnType<number, number, never>;
  completed_at: number | null;
  last_stage: string | null;
  last_event: string | null;
  error_summary: string | null;
}

// ============================================================================
// Browser Tables (028_browser)
// ============================================================================

export interface TabGroupsTable {
  id: string;
  name: string;
  color: string;
  pot_id: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface ShelfTabsTable {
  id: string;
  url: string;
  title: string | null;
  favicon_url: string | null;
  group_id: string | null;
  note: string | null;
  shelved_at: ColumnType<number, number, never>;
  last_active_at: number | null;
}

export interface BrowserSessionsTable {
  id: string;
  name: string;
  tab_snapshot: string;    // JSON: TabState[]
  shelf_snapshot: string;  // JSON: ShelfItem[]
  groups_snapshot: string; // JSON: TabGroup[]
  created_at: ColumnType<number, number, never>;
}

export interface BrowserHistoryTable {
  id: string;
  url: string;
  title: string | null;
  visit_time: ColumnType<number, number, never>;
  tab_id: string | null;
  session_id: string | null;
  date_key: string | null;
}

// ============================================================================
// Calendar Domain Types (029_calendar)
// ============================================================================

export interface CalendarEvent {
  id: string;
  pot_id: string | null;
  title: string;
  details: string | null;
  start_at: number;
  end_at: number | null;
  all_day: boolean;
  importance: number;
  date_key: string;
  created_at: number;
  updated_at: number;
}

export interface CalendarEntryDate {
  id: string;
  entry_id: string;
  pot_id: string;
  date_key: string;
  source_kind: 'capture_date' | 'extracted_date';
  label: string | null;
  confidence: number | null;
  artifact_id: string | null;
  created_at: number;
}

export interface CalendarNotification {
  id: string;
  date_key: string;
  title: string;
  body: string;
  item_type: 'event' | 'entry_date';
  item_id: string;
  shown_at: number | null;
  read_at: number | null;
  created_at: number;
}

export interface CreateCalendarEventInput {
  pot_id?: string;
  title: string;
  details?: string;
  start_at: number;
  end_at?: number;
  all_day?: boolean;
  importance?: number;
  timezone?: string;
}

export interface UpdateCalendarEventInput {
  title?: string;
  details?: string;
  start_at?: number;
  end_at?: number;
  all_day?: boolean;
  importance?: number;
}

export interface UpsertCalendarEntryDateInput {
  entry_id: string;
  pot_id: string;
  date_key: string;
  source_kind: 'capture_date' | 'extracted_date';
  label?: string;
  confidence?: number;
  artifact_id?: string;
}

export interface CreateCalendarNotificationInput {
  date_key: string;
  title: string;
  body: string;
  item_type: 'event' | 'entry_date';
  item_id: string;
}

export interface CalendarRangeResult {
  events: CalendarEvent[];
  entry_date_counts: { [date_key: string]: number };
  history_counts: { [date_key: string]: number };
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string | null;
  visit_time: number;
}

export interface CalendarDateResult {
  events: CalendarEvent[];
  entry_dates: CalendarEntryDate[];
  history: HistoryItem[];
}

export interface CalendarSearchResult {
  events: CalendarEvent[];
  entry_dates: CalendarEntryDate[];
}

// ============================================================================
// Calendar Tables (029_calendar)
// ============================================================================

export interface CalendarEventsTable {
  id: string;
  pot_id: string | null;
  title: string;
  details: string | null;
  start_at: number;
  end_at: number | null;
  all_day: number;
  importance: number;
  date_key: string;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface CalendarEntryDatesTable {
  id: string;
  entry_id: string;
  pot_id: string;
  date_key: string;
  source_kind: 'capture_date' | 'extracted_date';
  label: string | null;
  confidence: number | null;
  artifact_id: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface CalendarEventLinksTable {
  id: string;
  event_id: string;
  entry_id: string;
  created_at: ColumnType<number, number, never>;
}

export interface CalendarNotificationsTable {
  id: string;
  date_key: string;
  title: string;
  body: string;
  item_type: 'event' | 'entry_date';
  item_id: string;
  shown_at: number | null;
  read_at: number | null;
  created_at: ColumnType<number, number, never>;
}

// ============================================================================
// DYK Domain Types (030_dyk)
// ============================================================================

export type DykStatus = 'new' | 'queued' | 'shown' | 'known' | 'interested' | 'snoozed' | 'useless' | 'archived';
export type DykSourceType = 'entry_summary' | 'entry_entities' | 'entry_tags' | 'intel_answer' | 'deep_research' | 'idle_sweep' | 'manual';

export interface DykItem {
  id: string;
  pot_id: string;
  entry_id: string;
  title: string;
  body: string;
  keywords: string[];
  confidence: number;
  novelty: number;
  source_type: DykSourceType;
  status: DykStatus;
  shown_count: number;
  signature: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  role_hash: string | null;
  evidence: any | null;
  next_eligible_at: number;
  created_at: number;
  updated_at: number;
}

export interface DykFeedbackEvent {
  id: string;
  dyk_id: string;
  pot_id: string;
  action: 'known' | 'interested' | 'snooze' | 'useless' | 'opened_chat' | 'opened_search';
  snooze_hours: number | null;
  engine_id: string | null;
  created_at: number;
}

export interface DykNotification {
  id: string;
  pot_id: string;
  dyk_id: string;
  title: string;
  body: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: number;
  read_at: number | null;
}

export interface DykState {
  last_novelty_scan?: number;
  scan_interval_ms?: number;
  [key: string]: any;
}

export interface CreateDykItemInput {
  pot_id: string;
  entry_id: string;
  title: string;
  body: string;
  keywords: string[];
  confidence: number;
  novelty: number;
  source_type: DykSourceType;
  signature: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  role_hash?: string;
  evidence?: any;
}

export interface CreateDykFeedbackEventInput {
  dyk_id: string;
  pot_id: string;
  action: 'known' | 'interested' | 'snooze' | 'useless' | 'opened_chat' | 'opened_search';
  snooze_hours?: number;
  engine_id?: string;
}

export interface CreateDykNotificationInput {
  pot_id: string;
  dyk_id: string;
  title: string;
  body: string;
}

export interface DykListOptions {
  status?: DykStatus;
  source_type?: DykSourceType;
  min_confidence?: number;
  min_novelty?: number;
  limit?: number;
  offset?: number;
  sort_by?: 'created_at' | 'novelty' | 'confidence';
  sort_desc?: boolean;
}

export interface PotOnboarding {
  id: string;
  pot_id: string;
  completed_at: number | null;
  goal_text: string | null;
  role_ref: string | null;
  search_targets: string[];
  state: { [key: string]: any };
  created_at: number;
  updated_at: number;
}

export interface UpsertOnboardingInput {
  completed_at?: number;
  goal_text?: string;
  role_ref?: string;
  search_targets?: string[];
  state?: { [key: string]: any };
}

export type OnboardingCompleteRequestSchema = { goal_text?: string; role_ref?: string; search_targets?: string[] };
export type PotSettingsUpdateSchema = { goal_text?: string; role_ref?: string; search_targets?: string[] };

// ============================================================================
// DYK Tables (030_dyk)
// ============================================================================

export interface DykItemsTable {
  id: string;
  pot_id: string;
  entry_id: string;
  title: string;
  body: string;
  keywords_json: string;
  confidence: number;
  novelty: number;
  source_type: 'entry_summary' | 'entry_entities' | 'entry_tags' | 'intel_answer' | 'deep_research' | 'idle_sweep' | 'manual';
  status: 'new' | 'queued' | 'shown' | 'known' | 'interested' | 'snoozed' | 'useless' | 'archived';
  shown_count: number;
  signature: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  role_hash: string | null;
  evidence_json: string | null;
  next_eligible_at: number;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface DykFeedbackEventsTable {
  id: string;
  dyk_id: string;
  pot_id: string;
  action: 'known' | 'interested' | 'snooze' | 'useless' | 'opened_chat' | 'opened_search';
  snooze_hours: number | null;
  engine_id: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface DykNotificationsTable {
  id: string;
  pot_id: string;
  dyk_id: string;
  title: string;
  body: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: ColumnType<number, number, never>;
  read_at: number | null;
}

export interface PotOnboardingTable {
  id: string;
  pot_id: string;
  completed_at: number | null;
  goal_text: string | null;
  role_ref: string | null;
  search_targets_json: string;
  state_json: string;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

// ============================================================================
// MoM Chat Run Tables (033_mom_chat_runs)
// ============================================================================

export type ChatRunExecutionMode = 'single' | 'mom_lite' | 'mom_standard' | 'mom_heavy';
export type ChatRunStatus = 'pending' | 'planning' | 'running' | 'merging' | 'done' | 'failed' | 'cancelled';
export type ChatRunAgentStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ChatRunsTable {
  id: string;
  thread_id: string;
  pot_id: string | null;
  user_message_id: string | null;
  chat_surface: 'pot' | 'main';
  execution_mode: ChatRunExecutionMode;
  status: ChatRunStatus;
  planner_model_id: string | null;
  merge_model_id: string | null;
  planner_output_json: string | null;
  final_output_json: string | null;
  context_fingerprint: string | null;
  error_message: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface ChatRunAgentsTable {
  id: string;
  chat_run_id: string;
  agent_index: number;
  agent_role: string;
  model_id: string;
  status: ChatRunAgentStatus;
  input_hash: string | null;
  output_json: string | null;
  latency_ms: number | null;
  token_usage_json: string | null;
  error_message: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface ChatRunReviewsTable {
  id: string;
  chat_run_id: string;
  reviewer_agent_id: string | null;
  target_agent_id: string | null;
  model_id: string;
  review_output_json: string | null;
  latency_ms: number | null;
  token_usage_json: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface ChatRunEventsTable {
  id: string;
  chat_run_id: string;
  event_type: string;
  payload_json: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface ChatRun {
  id: string;
  thread_id: string;
  pot_id: string | null;
  user_message_id: string | null;
  chat_surface: 'pot' | 'main';
  execution_mode: ChatRunExecutionMode;
  status: ChatRunStatus;
  planner_model_id: string | null;
  merge_model_id: string | null;
  planner_output: Record<string, unknown> | null;
  final_output: Record<string, unknown> | null;
  context_fingerprint: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface ChatRunAgent {
  id: string;
  chat_run_id: string;
  agent_index: number;
  agent_role: string;
  model_id: string;
  status: ChatRunAgentStatus;
  input_hash: string | null;
  output: Record<string, unknown> | null;
  latency_ms: number | null;
  token_usage: Record<string, unknown> | null;
  error_message: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface CreateChatRunInput {
  thread_id: string;
  pot_id?: string;
  user_message_id?: string;
  chat_surface: 'pot' | 'main';
  execution_mode: ChatRunExecutionMode;
  context_fingerprint?: string;
}

export interface CreateChatRunAgentInput {
  chat_run_id: string;
  agent_index: number;
  agent_role: string;
  model_id: string;
  input_hash?: string;
}

export interface ChatRunReview {
  id: string;
  chat_run_id: string;
  reviewer_agent_id: string | null;
  target_agent_id: string | null;
  model_id: string;
  review_output: Record<string, unknown> | null;
  latency_ms: number | null;
  token_usage: Record<string, unknown> | null;
  created_at: number;
}

export interface CreateChatRunReviewInput {
  chat_run_id: string;
  reviewer_agent_id?: string;
  target_agent_id?: string;
  model_id: string;
}

// ── Voice Addon (034) ─────────────────────────────────────────────────────

export interface VoiceSettingsTable {
  id: number; // always 1
  selected_input_device: string | null;
  selected_output_device: string | null;
  selected_stt_engine: string;
  selected_voice_id: string | null;
  silence_timeout_ms: number;
  vad_threshold: number;
  push_to_talk_enabled: number; // 0|1
  manual_send_enabled: number;
  interruption_enabled: number;
  partial_transcripts_enabled: number;
  stream_tts_enabled: number;
  local_only_mode: number;
  updated_at: number;
}

export interface VoiceVoicesTable {
  id: string;
  display_name: string;
  lang_code: string;
  speaker_name: string;
  quality: 'low' | 'medium' | 'high' | 'x_low';
  engine_type: 'piper';
  source_path: string;
  is_imported: number; // 0|1
  file_hash: string | null;
  sample_rate: number | null;
  num_speakers: number;
  piper_version: string | null;
  enabled: number; // 0|1
  created_at: ColumnType<number, number, never>;
}

export interface VoiceSessionsTable {
  id: string;
  status: 'active' | 'stopped' | 'errored';
  voice_id: string | null;
  stt_engine: string | null;
  input_device: string | null;
  output_device: string | null;
  pot_id: string | null;
  turn_count: number;
  interruption_count: number;
  avg_stt_latency_ms: number | null;
  avg_tts_latency_ms: number | null;
  error_message: string | null;
  started_at: ColumnType<number, number, never>;
  stopped_at: number | null;
  updated_at: number;
}

export interface VoiceSessionEventsTable {
  id: string;
  session_id: string;
  event_type: string;
  payload_json: string | null;
  latency_ms: number | null;
  created_at: ColumnType<number, number, never>;
}

// ── Nutrition Module (036) ────────────────────────────────────────────────

export interface NutritionMealsTable {
  id: string;
  pot_id: string;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  asset_id: string | null;
  user_note: string | null;
  user_correction: string | null;
  analysis_json: string | null;
  error_message: string | null;
  accepted: number; // 0|1
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface NutritionDailyReviewsTable {
  id: string;
  pot_id: string;
  review_date: string;
  model_id: string;
  prompt_version: string;
  payload_json: string;
  meal_ids_json: string;
  created_at: ColumnType<number, number, never>;
}

export interface NutritionWeeklyCheckInsTable {
  id: string;
  pot_id: string;
  week_key: string;
  weight: number | null;
  weight_unit: 'kg' | 'lbs' | null;
  body_fat_pct: number | null;
  rating: number | null;
  notes: string | null;
  submitted_at: number;
}

export interface NutritionWeeklyReviewsTable {
  id: string;
  pot_id: string;
  week_key: string;
  check_in_id: string | null;
  model_id: string;
  prompt_version: string;
  payload_json: string;
  created_at: ColumnType<number, number, never>;
}

export interface NutritionRecipesTable {
  id: string;
  pot_id: string;
  title: string;
  category: 'starter' | 'main' | 'dessert' | 'snack';
  cuisine_tags: string;
  key_ingredients: string;
  flavor_profile: string | null;
  meal_type_tags: string;
  full_recipe_json: string;
  feedback: 'liked' | 'disliked' | null;
  generation_mode: 'random' | 'ingredient_led' | 'craving';
  source_prompt: string | null;
  model_id: string;
  prompt_version: string;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

// Domain types

export interface NutritionMeal {
  id: string;
  pot_id: string;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  asset_id: string | null;
  user_note: string | null;
  user_correction: Record<string, unknown> | null;
  analysis_json: Record<string, unknown> | null;
  error_message: string | null;
  accepted: boolean;
  created_at: number;
  updated_at: number;
}

export interface NutritionDailyReview {
  id: string;
  pot_id: string;
  review_date: string;
  model_id: string;
  prompt_version: string;
  payload: Record<string, unknown>;
  meal_ids: string[];
  created_at: number;
}

export interface NutritionWeeklyCheckIn {
  id: string;
  pot_id: string;
  week_key: string;
  weight: number | null;
  weight_unit: 'kg' | 'lbs' | null;
  body_fat_pct: number | null;
  rating: number | null;
  notes: string | null;
  submitted_at: number;
}

export interface NutritionWeeklyReview {
  id: string;
  pot_id: string;
  week_key: string;
  check_in_id: string | null;
  model_id: string;
  prompt_version: string;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface NutritionRecipe {
  id: string;
  pot_id: string;
  title: string;
  category: 'starter' | 'main' | 'dessert' | 'snack';
  cuisine_tags: string[];
  key_ingredients: string[];
  flavor_profile: string | null;
  meal_type_tags: string[];
  full_recipe: Record<string, unknown>;
  feedback: 'liked' | 'disliked' | null;
  generation_mode: 'random' | 'ingredient_led' | 'craving';
  source_prompt: string | null;
  model_id: string;
  prompt_version: string;
  created_at: number;
  updated_at: number;
}

export interface CreateNutritionMealInput {
  pot_id: string;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  asset_id?: string;
  user_note?: string;
}

export interface CreateNutritionRecipeInput {
  pot_id: string;
  title: string;
  category: 'starter' | 'main' | 'dessert' | 'snack';
  cuisine_tags: string[];
  key_ingredients: string[];
  flavor_profile?: string;
  meal_type_tags: string[];
  full_recipe: Record<string, unknown>;
  generation_mode: 'random' | 'ingredient_led' | 'craving';
  source_prompt?: string;
  model_id: string;
  prompt_version: string;
}

// ── Wellness Addon (037) ──────────────────────────────────────────────────

export interface NutritionWellbeingLogsTable {
  id: string;
  pot_id: string;
  log_date: string;
  symptoms: string; // JSON string[]
  mood: number | null;
  energy: number | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  anxiety: number | null;
  notes: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface NutritionSupplementsTable {
  id: string;
  pot_id: string;
  name: string;
  default_dose: number | null;
  dose_unit: string | null;
  notes: string | null;
  is_active: number; // 0|1
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface NutritionSupplementEntriesTable {
  id: string;
  pot_id: string;
  supplement_id: string;
  entry_date: string;
  entry_time: string | null;
  dose: number | null;
  dose_unit: string | null;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  notes: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface NutritionPatternAnalysesTable {
  id: string;
  pot_id: string;
  analysis_type: 'food_symptom' | 'ingredient_sensitivity' | 'stack_review';
  model_id: string;
  prompt_version: string;
  date_range_from: string;
  date_range_to: string;
  payload_json: string;
  triggered_by: string;
  created_at: ColumnType<number, number, never>;
}

// Domain types

export interface NutritionWellbeingLog {
  id: string;
  pot_id: string;
  log_date: string;
  symptoms: string[];
  mood: number | null;
  energy: number | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  anxiety: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface NutritionSupplement {
  id: string;
  pot_id: string;
  name: string;
  default_dose: number | null;
  dose_unit: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface NutritionSupplementEntry {
  id: string;
  pot_id: string;
  supplement_id: string;
  entry_date: string;
  entry_time: string | null;
  dose: number | null;
  dose_unit: string | null;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  notes: string | null;
  created_at: number;
}

export interface NutritionPatternAnalysis {
  id: string;
  pot_id: string;
  analysis_type: 'food_symptom' | 'ingredient_sensitivity' | 'stack_review';
  model_id: string;
  prompt_version: string;
  date_range_from: string;
  date_range_to: string;
  payload: Record<string, unknown>;
  triggered_by: string;
  created_at: number;
}

// Input types

export interface UpsertWellbeingLogInput {
  symptoms?: string[];
  mood?: number;
  energy?: number;
  sleep_quality?: number;
  sleep_hours?: number;
  anxiety?: number;
  notes?: string;
}

export interface CreateNutritionSupplementInput {
  pot_id: string;
  name: string;
  default_dose?: number;
  dose_unit?: string;
  notes?: string;
}

export interface CreateNutritionSupplementEntryInput {
  pot_id: string;
  supplement_id: string;
  entry_date: string;
  entry_time?: string;
  dose?: number;
  dose_unit?: string;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  notes?: string;
}

export interface CreateNutritionPatternAnalysisInput {
  pot_id: string;
  analysis_type: 'food_symptom' | 'ingredient_sensitivity' | 'stack_review';
  model_id: string;
  prompt_version: string;
  date_range_from: string;
  date_range_to: string;
  payload: Record<string, unknown>;
  triggered_by?: string;
}

// ── RSS Feed Module (038) ─────────────────────────────────────────────────

export interface RssFeedsTable {
  id: string;
  url: string;
  title: string;
  description: string | null;
  site_url: string | null;
  pot_ids: string; // JSON: string[]
  enabled: number; // 0|1
  trusted: number; // 0|1
  user_added: number; // 0|1
  post_frequency: string | null;
  last_fetched_at: number | null;
  error_count: number;
  last_error: string | null;
  fetch_etag: string | null;
  fetch_modified: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface RssArticlesTable {
  id: string;
  feed_id: string;
  guid: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number;
  pot_tags: string; // JSON: string[]
  is_read: number; // 0|1
  created_at: ColumnType<number, number, never>;
}

export interface RssArticleFeedbackTable {
  id: string;
  article_id: string;
  feedback: 'liked' | 'disliked' | 'hidden';
  created_at: ColumnType<number, number, never>;
}

export interface RssFeedSuggestionsTable {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  reason: string | null;
  example_articles: string; // JSON: string[]
  post_frequency: string | null;
  suggested_at: number;
  dismissed: number; // 0|1
  added: number; // 0|1
}

// Domain types

export interface RssFeed {
  id: string;
  url: string;
  title: string;
  description: string | null;
  site_url: string | null;
  pot_ids: string[];
  enabled: boolean;
  trusted: boolean;
  user_added: boolean;
  post_frequency: string | null;
  last_fetched_at: number | null;
  error_count: number;
  last_error: string | null;
  fetch_etag: string | null;
  fetch_modified: string | null;
  created_at: number;
  updated_at: number;
}

export interface RssArticle {
  id: string;
  feed_id: string;
  guid: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number;
  pot_tags: string[];
  is_read: boolean;
  created_at: number;
  feedback?: 'liked' | 'disliked' | 'hidden' | null;
}

export interface RssFeedSuggestion {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  reason: string | null;
  example_articles: string[];
  post_frequency: string | null;
  suggested_at: number;
  dismissed: boolean;
  added: boolean;
}

export interface CreateRssFeedInput {
  url: string;
  title: string;
  description?: string;
  site_url?: string;
  pot_ids?: string[];
  trusted?: boolean;
  user_added?: boolean;
  post_frequency?: string;
  fetch_etag?: string;
  fetch_modified?: string;
}

export interface UpdateRssFeedInput {
  title?: string;
  description?: string;
  site_url?: string;
  pot_ids?: string[];
  enabled?: boolean;
  trusted?: boolean;
  post_frequency?: string;
  last_fetched_at?: number;
  error_count?: number;
  last_error?: string | null;
  fetch_etag?: string | null;
  fetch_modified?: string | null;
}

export interface UpsertRssArticleInput {
  feed_id: string;
  guid: string;
  title: string;
  url: string;
  author?: string;
  summary?: string;
  image_url?: string;
  published_at?: number;
  pot_tags?: string[];
}

export interface CreateRssFeedSuggestionInput {
  title?: string;
  description?: string;
  reason?: string;
  example_articles?: string[];
  post_frequency?: string;
}

export interface RssSettings {
  enabled: boolean;
  collect_time: string; // HH:MM, default '06:00'
  articles_per_page: number; // default 10
  retention_days: number; // default 30
}

// ── Entry Translations (035) ──────────────────────────────────────────────

export interface EntryTranslationsTable {
  id: string;
  entry_id: string;
  target_language: string;
  target_language_code: string;
  translated_text: string;
  model_id: string;
  chunk_count: number;
  source_hash: string;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

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

export interface UpsertTranslationInput {
  entry_id: string;
  target_language: string;
  target_language_code: string;
  translated_text: string;
  model_id: string;
  chunk_count: number;
  source_hash: string;
}

export interface Database {
  pots: PotsTable;
  entries: EntriesTable;
  assets: AssetsTable; // Phase 4
  audit_events: AuditEventsTable;
  migrations: MigrationsTable;
  user_prefs: UserPrefsTable;
  processing_jobs: ProcessingJobsTable; // Phase 5
  job_logs: JobLogsTable; // Phase 5
  ai_models: AiModelsTable; // Phase 6
  derived_artifacts: DerivedArtifactsTable; // Phase 7
  link_candidates: LinkCandidatesTable; // Phase 8
  links: LinksTable; // Phase 8
  intelligence_runs: IntelligenceRunsTable; // intel-gen
  intelligence_questions: IntelligenceQuestionsTable; // intel-gen
  intelligence_answers: IntelligenceAnswersTable; // intel-gen
  intelligence_known_questions: IntelligenceKnownQuestionsTable; // intel-gen
  journal_entries: JournalEntriesTable; // journal module
  planning_runs: PlanningRunsTable; // planning module
  planning_answers: PlanningAnswersTable; // planning module
  planning_files: PlanningFilesTable; // planning module
  // deep research (021)
  research_artifacts: ResearchArtifactsTable;
  research_runs: ResearchRunsTable;
  research_schedules: ResearchSchedulesTable;
  research_notifications: ResearchNotificationsTable;
  // chat (024)
  chat_threads: ChatThreadsTable;
  chat_messages: ChatMessagesTable;
  // main chat (026/027)
  main_chat_threads: MainChatThreadsTable;
  main_chat_messages: MainChatMessagesTable;
  main_chat_notifications: MainChatNotificationsTable;
  // browser (028)
  tab_groups: TabGroupsTable;
  shelf_tabs: ShelfTabsTable;
  browser_sessions: BrowserSessionsTable;
  browser_history: BrowserHistoryTable;
  // calendar (029)
  calendar_events: CalendarEventsTable;
  calendar_entry_dates: CalendarEntryDatesTable;
  calendar_event_links: CalendarEventLinksTable;
  calendar_notifications: CalendarNotificationsTable;
  // dyk (030)
  dyk_items: DykItemsTable;
  dyk_feedback_events: DykFeedbackEventsTable;
  dyk_notifications: DykNotificationsTable;
  pot_onboarding: PotOnboardingTable;
  // flow correlation (031/032)
  flow_runs: FlowRunsTable;
  // mom chat (033)
  chat_runs: ChatRunsTable;
  chat_run_agents: ChatRunAgentsTable;
  chat_run_reviews: ChatRunReviewsTable;
  chat_run_events: ChatRunEventsTable;
  // voice addon (034)
  voice_settings: VoiceSettingsTable;
  voice_voices: VoiceVoicesTable;
  voice_sessions: VoiceSessionsTable;
  voice_session_events: VoiceSessionEventsTable;
  // entry translations (035)
  entry_translations: EntryTranslationsTable;
  // nutrition module (036)
  nutrition_meals: NutritionMealsTable;
  nutrition_daily_reviews: NutritionDailyReviewsTable;
  nutrition_weekly_check_ins: NutritionWeeklyCheckInsTable;
  nutrition_weekly_reviews: NutritionWeeklyReviewsTable;
  nutrition_recipes: NutritionRecipesTable;
  // wellness addon (037)
  nutrition_wellbeing_logs: NutritionWellbeingLogsTable;
  nutrition_supplements: NutritionSupplementsTable;
  nutrition_supplement_entries: NutritionSupplementEntriesTable;
  nutrition_pattern_analyses: NutritionPatternAnalysesTable;
  // rss module (038)
  rss_feeds: RssFeedsTable;
  rss_articles: RssArticlesTable;
  rss_article_feedback: RssArticleFeedbackTable;
  rss_feed_suggestions: RssFeedSuggestionsTable;
  // agent core (040)
  agent_configs: AgentConfigsTable;
  agent_runs: AgentRunsTable;
  agent_candidates: AgentCandidatesTable;
  agent_feedback_events: AgentFeedbackEventsTable;
  agent_schedules: AgentSchedulesTable;
  // agent artifacts (041)
  agent_artifacts: AgentArtifactsTable;
  // agent snapshots (042)
  agent_snapshots: AgentSnapshotsTable;
  // agent tools (043)
  agent_tools: AgentToolsTable;
  agent_tool_versions: AgentToolVersionsTable;
  agent_tool_runs: AgentToolRunsTable;
  // automation & heartbeat (044-046)
  pot_automation_settings: PotAutomationSettingsTable;
  scheduled_tasks: ScheduledTasksTable;
  task_runs: TaskRunsTable;
  heartbeat_snapshots: HeartbeatSnapshotsTable;
  heartbeat_documents: HeartbeatDocumentsTable;
}

/**
 * Domain types for application use
 */

export interface Pot {
  id: string;
  name: string;
  description: string | null;
  security_level: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null; // Phase 3: for popup sorting
  // Agent roles (018_pot_role)
  role_ref: string | null;
  role_hash: string | null;
  role_updated_at: number | null;
  // DYK / onboarding (030_dyk)
  goal_text: string | null;
  search_targets: string[];
}

export interface Entry {
  id: string;
  pot_id: string;
  type: 'text' | 'image' | 'doc' | 'link' | 'audio' | 'chat';
  content_text: string | null; // Phase 4: nullable for asset-backed entries
  content_sha256: string | null; // Phase 4: nullable for asset-backed entries
  capture_method: string;
  source_url: string | null;
  source_title: string | null;
  notes: string | null;
  captured_at: number;
  created_at: number;
  updated_at: number;
  // Phase 3: idempotency and metadata
  client_capture_id: string | null;
  source_app: string | null;
  source_context: Record<string, unknown> | null;
  // Phase 4: asset reference
  asset_id: string | null;
  // Phase 11: link-specific fields
  link_url: string | null;
  link_title: string | null;
}

export interface Asset {
  id: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename: string | null;
  storage_path: string;
  encryption_version: number;
  created_at: number;
}

export interface LinkCandidate {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  reason: string;
  score: number;
  status: 'new' | 'processing' | 'processed' | 'skipped';
  created_at: number;
}

export interface Link {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  link_type: 'same_topic' | 'same_entity' | 'supports' | 'contradicts' | 'references' | 'sequence' | 'duplicate' | 'other';
  confidence: number;
  rationale: string;
  evidence: LinkEvidence[];
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  created_at: number;
}

export interface LinkEvidence {
  side: 'src' | 'dst';
  start: number;
  end: number;
  excerpt: string;
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  actor: 'user' | 'system' | 'extension';
  action: string;
  pot_id: string | null;
  entry_id: string | null;
  metadata: Record<string, unknown>;
  // flow correlation (031_flow_correlation)
  job_id: string | null;
}

export interface CreatePotInput {
  name: string;
  description?: string;
}

export interface UpdatePotInput {
  name?: string;
  description?: string;
}

export interface CreateTextEntryInput {
  pot_id: string;
  content_text: string;
  capture_method: string;
  source_url?: string;
  source_title?: string;
  notes?: string;
  captured_at?: number; // defaults to now
}

/**
 * Phase 4: Asset-backed entry inputs
 */
export interface CreateAssetEntryInput {
  pot_id: string;
  asset_id: string;
  capture_method: string;
  source_url?: string;
  source_title?: string;
  notes?: string;
  captured_at?: number;
  client_capture_id?: string; // Phase 11: idempotency for extension uploads
}

export interface CreateAssetInput {
  sha256: string;
  size_bytes: number;
  mime_type: string;
  original_filename?: string;
  storage_path: string;
}

export interface ListEntriesFilters {
  pot_id: string;
  capture_method?: string;
  source_url?: string;
  limit?: number;
  offset?: number;
}

/**
 * Phase 3: Capture preferences
 */
export interface CapturePreferences {
  default_pot_id?: string;
  last_pot_id?: string;
  autosave?: {
    enabled: boolean;
    pot_overrides?: Record<string, boolean>; // pot_id -> enabled/disabled
  };
  popup?: {
    pot_list_limit?: number;
    sort_mode?: 'recent';
  };
}

/**
 * Phase 3: Idempotent capture input
 */
export interface CreateTextEntryIdempotentInput extends CreateTextEntryInput {
  client_capture_id?: string;
  source_app?: string;
  source_context?: Record<string, unknown>;
}

/**
 * Phase 3: Capture result with dedupe info
 */
export interface CaptureResult {
  created: boolean;
  entry: Entry;
  deduped: boolean;
  dedupe_reason?: 'client_capture_id' | 'hash_window';
}

/**
 * Phase 4: Entry with embedded asset metadata
 */
export interface EntryWithAsset extends Entry {
  asset?: Asset;
}

/**
 * Phase 5: Processing job domain type
 */
export interface ProcessingJob {
  id: string;
  pot_id: string | null;
  entry_id: string | null;
  job_type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'canceled';
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: number;
  locked_by: string | null;
  locked_at: number | null;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  payload_json: string | null; // Journal module: structured job payload
  // flow correlation (031_flow_correlation)
  flow_id: string | null;
}

// ============================================================================
// Flow Runs Domain Types (032_flow_runs)
// ============================================================================

export interface FlowRun {
  id: string;
  flow_type: string;
  status: 'started' | 'completed' | 'failed' | 'partial';
  pot_id: string | null;
  entry_id: string | null;
  started_at: number;
  completed_at: number | null;
  last_stage: string | null;
  last_event: string | null;
  error_summary: string | null;
}

export interface CreateFlowRunInput {
  id: string;
  flow_type: string;
  pot_id?: string;
  entry_id?: string;
}

export interface PlanningRun {
  id: string;
  pot_id: string;
  project_name: string;
  project_type: string;
  status: PlanningRunStatus;
  revision: number;
  approved_at: number | null;
  rejected_reason: string | null;
  model_profile: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export type PlanningRunStatus = PlanningRunsTable['status'];

export interface PlanningAnswer {
  id: string;
  run_id: string;
  revision: number;
  answers: unknown;
  created_at: number;
}

export interface PlanningFile {
  id: string;
  run_id: string;
  revision: number;
  path: string;
  kind: string;
  content_text: string | null;
  asset_id: string | null;
  sha256: string;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  temperature: number | null;
  max_tokens: number | null;
  created_at: number;
}

export interface PlanningFileProvenance {
  model_id?: string;
  prompt_id?: string;
  prompt_version?: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Phase 6: AI model domain type
 */
export interface AiModel {
  id: string;
  name: string;
  context_length: number;
  pricing_prompt: number | null;
  pricing_completion: number | null;
  supports_vision: boolean;
  supports_tools: boolean;
  architecture: string | null;
  modalities: string | null;
  top_provider: string | null;
  fetched_at: number;
  created_at: number;
}

/**
 * Phase 6: AI preferences
 */
export interface AiPreferences {
  default_model?: string;
  task_models?: {
    tagging?: string;
    linking?: string;
    summarization?: string;
    entity_extraction?: string;
    image_tagging?: string;
    video_transcription?: string;
    audio_transcription?: string; // Audio entry transcription
    journaling?: string; // Journal module
    deep_research?: string; // Deep research agent
    chat?: string; // Pot chat
    translation?: string; // Entry translation
  };
  mom_models?: {
    planner?: string;    // Model used for the MoM planning step
    specialist?: string; // Model used for each specialist agent
    merge?: string;      // Model used for the final merge step
  };
  nutrition_models?: {
    meal_image_analysis?: string;
    daily_review?: string;
    weekly_review?: string;
    recipe_generation?: string;
    craving_assistant?: string;
    pattern_analysis?: string;
    stack_analysis?: string;
  };
  rss_models?: {
    feed_discovery?: string;
  };
  agent_models?: {
    reflection?: string;
    ranking?: string;
    tool_spec?: string;
    codegen?: string;
    static_review?: string;
    test_evaluation?: string;
  };
  automation_models?: {
    heartbeat?: string;
    task_planning?: string;
    task_execution?: string;
  };
  chat_personality_prompt?: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * System logging preferences
 */
export interface LoggingPreferences {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Phase 7: Derived artifact domain type
 */
export interface DerivedArtifact {
  id: string;
  pot_id: string;
  entry_id: string;
  artifact_type: 'tags' | 'entities' | 'summary' | 'extracted_text';
  schema_version: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  created_at: number;
  payload: unknown; // Parsed from payload_json
  evidence: unknown | null; // Parsed from evidence_json
  role_hash: string | null; // Which role generated this artifact (018_pot_role)
}

/**
 * Phase 7: Create artifact input
 */
export interface CreateArtifactInput {
  pot_id: string;
  entry_id: string;
  artifact_type: 'tags' | 'entities' | 'summary' | 'extracted_text';
  schema_version?: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens?: number;
  payload: unknown;
  evidence?: unknown;
  role_hash?: string | null; // Which role generated this artifact (018_pot_role)
}

/**
 * Phase 9: Export/Import types
 */

export interface ExportPotOptions {
  mode: 'private' | 'public';
  bundle_name?: string;
  passphrase: string;
  passphrase_hint?: string;
}

export interface ImportPotOptions {
  bundle_path: string;
  passphrase: string;
  import_as_name?: string;
}

export interface ExportResult {
  bundle_path: string;
  bundle_sha256: string;
}

export interface ImportResult {
  pot_id: string;
  stats: {
    entries: number;
    assets: number;
    artifacts: number;
    links: number;
  };
}

/**
 * Phase 11: Extension token management
 */
export interface ExtensionToken {
  token: string; // 32-byte random hex string
  created_at: number;
  last_rotated_at: number;
}

/**
 * Phase 11: Create link entry input
 */
export interface CreateLinkEntryInput {
  pot_id: string;
  link_url: string;
  link_title?: string;
  content_text?: string; // optional excerpt
  capture_method: string;
  captured_at?: number;
  client_capture_id?: string;
  source_app?: string;
  source_context?: Record<string, unknown>;
}

// ============================================================================
// Intelligence Gen Domain Types (Phase intel-gen)
// ============================================================================

export interface IntelligenceRun {
  id: string;
  pot_id: string;
  mode: 'full' | 'digest';
  model_id: string;
  prompt_version: string;
  pot_snapshot_hash: string;
  estimated_input_tokens: number;
  context_length: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  error_message: string | null;
  custom_prompt: string | null;
  max_questions: number;
  created_at: number;
  finished_at: number | null;
}

export interface IntelligenceQuestion {
  id: string;
  run_id: string;
  pot_id: string;
  question_signature: string;
  question_text: string;
  entry_ids: string[]; // Parsed from entry_ids_json
  category: 'synthesis' | 'contradiction_check' | 'timeline' | 'claim_validation' | 'entity_profile' | 'lead' | 'other' | null;
  rationale: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  created_at: number;
}

export interface IntelAnswerEvidence {
  entry_id: string;
  excerpt: string;
  start_offset?: number;
  end_offset?: number;
}

export interface IntelligenceAnswer {
  id: string;
  question_id: string;
  pot_id: string;
  answer_text: string;
  confidence: number;
  evidence: IntelAnswerEvidence[];
  excerpt_validation: 'pass' | 'fail';
  excerpt_validation_details: string | null;
  limits_text: string | null;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  token_usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  created_at: number;
}

export interface CreateIntelligenceRunInput {
  pot_id: string;
  mode: 'full' | 'digest';
  model_id: string;
  prompt_version: string;
  pot_snapshot_hash: string;
  estimated_input_tokens: number;
  context_length: number;
  custom_prompt?: string;
  max_questions?: number;
}

export interface CreateIntelligenceQuestionInput {
  run_id: string;
  pot_id: string;
  question_signature: string;
  question_text: string;
  entry_ids: string[];
  category?: IntelligenceQuestion['category'];
  rationale?: string;
}

export interface CreateIntelligenceAnswerInput {
  question_id: string;
  pot_id: string;
  answer_text: string;
  confidence: number;
  evidence: IntelAnswerEvidence[];
  excerpt_validation: 'pass' | 'fail';
  excerpt_validation_details?: string;
  limits_text?: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  token_usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// ============================================================================
// Journal Module Domain Types
// ============================================================================

export interface JournalEntry {
  id: string;
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
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
  content: unknown; // Parsed from content_json; validated by DailyNoteSchema | RollupNoteSchema
  citations: unknown; // Parsed from citations_json
}

export interface CreateJournalEntryInput {
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  scope_type: 'pot' | 'global';
  scope_id?: string;
  period_start_ymd: string;
  period_end_ymd: string;
  timezone: string;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens?: number;
  input_fingerprint: string;
  content: unknown;
  citations: unknown;
}

export interface JournalJobPayload {
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  scope_type: 'pot' | 'global';
  scope_id?: string;
  date_ymd?: string;       // for daily
  period_start_ymd?: string; // for rollups
  period_end_ymd?: string;   // for rollups
  timezone?: string;
}

// ============================================================================
// Processing Config (journal.enabled / budgets / etc.)
// ============================================================================

export interface JournalBudgetConfig {
  max_entries_per_day?: number;
  max_chars_per_entry?: number;
  max_total_chars?: number;
  max_tokens_daily_job?: number;
  max_tokens_rollup_job?: number;
  max_jobs_per_startup_backfill?: number;
}

export interface JournalConfig {
  enabled: boolean;
  scopes?: { global?: boolean; pots?: boolean };
  daily?: { enabled?: boolean; open_loops?: boolean; time_local?: string };
  rollups?: {
    weekly?: { enabled?: boolean; time_local?: string; mode?: string };
    monthly?: { enabled?: boolean; time_local?: string };
    quarterly?: { enabled?: boolean; time_local?: string };
    yearly?: { enabled?: boolean; time_local?: string };
  };
  budgets?: JournalBudgetConfig;
  models?: { daily_model?: string; rollup_model?: string };
  behavior?: {
    enqueue_prerequisites?: boolean;
    allow_rollup_fallback_to_daily?: boolean;
  };
}

export interface ProcessingConfig {
  journal?: JournalConfig;
}

export const DEFAULT_JOURNAL_CONFIG: JournalConfig = {
  enabled: false,
  scopes: { global: true, pots: true },
  daily: { enabled: true, open_loops: true },
  rollups: {
    weekly: { enabled: true },
    monthly: { enabled: true },
    quarterly: { enabled: true },
    yearly: { enabled: true },
  },
  budgets: {
    max_entries_per_day: 200,
    max_chars_per_entry: 12000,
    max_total_chars: 300000,
    max_tokens_daily_job: 1800,
    max_tokens_rollup_job: 2200,
    max_jobs_per_startup_backfill: 7,
  },
  behavior: {
    enqueue_prerequisites: true,
    allow_rollup_fallback_to_daily: true,
  },
};

// ============================================================================
// Deep Research Domain Types (021_deep_research)
// ============================================================================

export type ResearchRunStatus = ResearchRunsTable['status'];
export type ResearchArtifactType = ResearchArtifactsTable['artifact_type'];
export type ResearchNotificationType = ResearchNotificationsTable['type'];

export interface ResearchRun {
  id: string;
  pot_id: string;
  status: ResearchRunStatus;
  goal_prompt: string;
  config: Record<string, unknown>;
  selected_model: string | null;
  model_overrides: Record<string, string> | null;
  plan_artifact_id: string | null;
  plan_approved_at: number | null;
  plan_approved_by: string | null;
  checkpoint_artifact_id: string | null;
  checkpoint: Record<string, unknown> | null;
  progress: Record<string, unknown>;
  budget_usage: Record<string, unknown>;
  previous_run_id: string | null;
  model_id: string | null;
  prompt_ids: string[] | null;
  entries_read: Array<{ id: string; sha256: string }> | null;
  sources_ingested: Array<{ url: string; sha256: string; entry_id: string }> | null;
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
  artifact_type: ResearchArtifactType;
  schema_version: number;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  temperature: number | null;
  payload: unknown;
  created_at: number;
}

export interface ResearchSchedule {
  id: string;
  pot_id: string;
  enabled: boolean;
  cron_like: string | null;
  timezone: string;
  goal_prompt: string;
  config: Record<string, unknown>;
  auto_approve_plan: boolean;
  last_run_id: string | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ResearchNotification {
  id: string;
  pot_id: string;
  run_id: string;
  type: ResearchNotificationType;
  message: string;
  metadata: Record<string, unknown>;
  read_at: number | null;
  created_at: number;
}

export interface CreateResearchRunInput {
  pot_id: string;
  goal_prompt: string;
  config?: Record<string, unknown>;
  selected_model?: string;
  model_overrides?: Record<string, string>;
  previous_run_id?: string;
}

export interface CreateResearchArtifactInput {
  run_id: string;
  artifact_type: ResearchArtifactType;
  schema_version?: number;
  model_id?: string;
  prompt_id?: string;
  prompt_version?: string;
  temperature?: number;
  payload: unknown;
}

export interface CreateResearchScheduleInput {
  pot_id: string;
  goal_prompt: string;
  enabled?: boolean;
  cron_like?: string;
  timezone?: string;
  config?: Record<string, unknown>;
  auto_approve_plan?: boolean;
}

export interface CreateResearchNotificationInput {
  pot_id: string;
  run_id: string;
  type: ResearchNotificationType;
  message: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Chat Domain Types (024_chat_tables)
// ============================================================================

export interface ChatThread {
  id: string;
  pot_id: string;
  title: string | null;
  model_id: string | null;
  personality_prompt_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChatMessageRecord {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: unknown[] | null;
  token_usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  model_id: string | null;
  created_at: number;
}

// ============================================================================
// MainChat Domain Types (026_main_chat)
// ============================================================================

export interface MainChatThread {
  id: string;
  title: string | null;
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MainChatMessageRecord {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  citations: unknown | null;
  token_usage: unknown | null;
  model_id: string | null;
  created_at: number;
}

export interface MainChatNotification {
  id: string;
  type: MainChatNotificationType;
  title: string;
  preview: string | null;
  payload: unknown | null;
  state: MainChatNotificationState;
  snoozed_until: number | null;
  read_at: number | null;
  created_at: number;
  // flow correlation (032_flow_runs)
  flow_id: string | null;
}

export interface CreateMainChatNotificationInput {
  type: MainChatNotificationType;
  title: string;
  preview?: string;
  payload?: unknown;
  // flow correlation (032_flow_runs)
  flow_id?: string;
}

// ============================================================================
// Voice Addon Domain Types (034_voice_tables)
// ============================================================================

export type VoiceQuality = 'low' | 'medium' | 'high' | 'x_low';
export type VoiceEngineType = 'piper';
export type VoiceSessionStatus = 'active' | 'stopped' | 'errored';

export interface VoiceSettings {
  id: number;
  selected_input_device: string | null;
  selected_output_device: string | null;
  selected_stt_engine: string;
  selected_voice_id: string | null;
  silence_timeout_ms: number;
  vad_threshold: number;
  push_to_talk_enabled: boolean;
  manual_send_enabled: boolean;
  interruption_enabled: boolean;
  partial_transcripts_enabled: boolean;
  stream_tts_enabled: boolean;
  local_only_mode: boolean;
  updated_at: number;
}

export interface VoiceVoice {
  id: string;
  display_name: string;
  lang_code: string;
  speaker_name: string;
  quality: VoiceQuality;
  engine_type: VoiceEngineType;
  source_path: string;
  is_imported: boolean;
  file_hash: string | null;
  sample_rate: number | null;
  num_speakers: number;
  piper_version: string | null;
  enabled: boolean;
  created_at: number;
}

export interface VoiceSession {
  id: string;
  status: VoiceSessionStatus;
  voice_id: string | null;
  stt_engine: string | null;
  input_device: string | null;
  output_device: string | null;
  pot_id: string | null;
  turn_count: number;
  interruption_count: number;
  avg_stt_latency_ms: number | null;
  avg_tts_latency_ms: number | null;
  error_message: string | null;
  started_at: number;
  stopped_at: number | null;
  updated_at: number;
}

export interface VoiceSessionEvent {
  id: string;
  session_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  latency_ms: number | null;
  created_at: number;
}

export interface UpdateVoiceSettingsInput {
  selected_input_device?: string | null;
  selected_output_device?: string | null;
  selected_stt_engine?: string;
  selected_voice_id?: string | null;
  silence_timeout_ms?: number;
  vad_threshold?: number;
  push_to_talk_enabled?: boolean;
  manual_send_enabled?: boolean;
  interruption_enabled?: boolean;
  partial_transcripts_enabled?: boolean;
  stream_tts_enabled?: boolean;
  local_only_mode?: boolean;
}

export interface CreateVoiceSessionInput {
  voice_id?: string;
  stt_engine?: string;
  input_device?: string;
  output_device?: string;
  pot_id?: string;
}

export interface UpsertVoiceVoiceInput {
  id: string;
  display_name: string;
  lang_code: string;
  speaker_name: string;
  quality: VoiceQuality;
  engine_type: VoiceEngineType;
  source_path: string;
  is_imported?: boolean;
  file_hash?: string | null;
  sample_rate?: number | null;
  num_speakers?: number;
  piper_version?: string | null;
  enabled?: boolean;
}

// ============================================================================
// Self-Evolving Research Agent Tables (040-043)
// ============================================================================

// ── Table interfaces ────────────────────────────────────────────────────────

export interface AgentConfigsTable {
  id: string;
  pot_id: string;
  enabled: number; // 0|1
  mode: 'quiet' | 'balanced' | 'bold';
  goal_text: string | null;
  cross_pot_enabled: number; // 0|1
  delivery_frequency: string;
  delivery_time_local: string;
  timezone: string;
  max_surprises_per_day: number;
  allow_tool_building: number; // 0|1
  allow_auto_test_low_risk_tools: number; // 0|1
  allow_auto_run_low_risk_tools: number; // 0|1
  quiet_hours_json: string | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface AgentRunsTable {
  id: string;
  pot_id: string;
  run_type: 'heartbeat' | 'manual' | 'tool_build' | 'tool_test' | 'tool_run' | 'cross_pot_bridge';
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  schedule_id: string | null;
  snapshot_id: string | null;
  selected_candidate_id: string | null;
  budget_usage_json: string | null;
  progress_json: string | null;
  model_id: string | null;
  prompt_ids_json: string | null;
  role_hash: string | null;
  created_at: ColumnType<number, number, never>;
  started_at: number | null;
  finished_at: number | null;
}

export type AgentCandidateType =
  | 'insight' | 'lead' | 'contradiction' | 'foreign_language_finding'
  | 'next_action' | 'tool_offer' | 'chat_seed' | 'search_prompt'
  | 'nutrition_correlation' | 'research_novelty' | 'journal_theme';

export interface AgentCandidatesTable {
  id: string;
  pot_id: string;
  run_id: string | null;
  candidate_type: AgentCandidateType;
  title: string;
  body: string;
  confidence: number;
  novelty: number;
  relevance: number;
  evidence_score: number;
  cost_score: number;
  fatigue_score: number;
  final_score: number;
  status: 'pending' | 'selected' | 'delivered' | 'snoozed' | 'archived' | 'rejected';
  signature: string;
  source_refs_json: string | null;
  launch_payload_json: string | null;
  delivered_at: number | null;
  next_eligible_at: number | null;
  created_at: ColumnType<number, number, never>;
}

export type AgentFeedbackAction =
  | 'cool' | 'meh' | 'undo' | 'known' | 'interested' | 'snooze' | 'useless'
  | 'approved_tool' | 'rejected_tool' | 'ran_tool' | 'disabled_tool'
  | 'opened_chat' | 'opened_search';

export interface AgentFeedbackEventsTable {
  id: string;
  pot_id: string;
  candidate_id: string;
  action: AgentFeedbackAction;
  metadata_json: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface AgentSchedulesTable {
  id: string;
  pot_id: string;
  enabled: number; // 0|1
  cron_like: string | null;
  timezone: string;
  last_run_id: string | null;
  next_run_at: number | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export type AgentArtifactType =
  | 'agent_reflection' | 'agent_surprise' | 'agent_tool_build_report'
  | 'agent_tool_test_report' | 'agent_tool_logs' | 'agent_tool_output'
  | 'agent_snapshot_report';

export interface AgentArtifactsTable {
  id: string;
  pot_id: string;
  run_id: string | null;
  tool_id: string | null;
  artifact_type: AgentArtifactType;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  role_hash: string | null;
  payload_json: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface AgentSnapshotsTable {
  id: string;
  pot_id: string;
  run_id: string | null;
  scope_json: string | null;
  storage_mode: 'temp_sqlite' | 'logical_slice';
  manifest_json: string | null;
  encrypted_path: string | null;
  status: 'creating' | 'ready' | 'in_use' | 'expired' | 'deleted';
  expires_at: number;
  created_at: ColumnType<number, number, never>;
  deleted_at: number | null;
}

export type AgentToolStatus =
  | 'draft' | 'testing' | 'awaiting_approval' | 'active'
  | 'disabled' | 'rejected' | 'archived';

export interface AgentToolsTable {
  id: string;
  pot_id: string;
  tool_key: string;
  name: string;
  description: string | null;
  language: 'python' | 'javascript';
  status: AgentToolStatus;
  version: number;
  parent_tool_id: string | null;
  bundle_hash: string | null;
  encrypted_bundle_path: string | null;
  manifest_json: string | null;
  input_schema_json: string | null;
  output_schema_json: string | null;
  capabilities_required_json: string | null;
  sandbox_policy_json: string | null;
  network_policy: 'none' | 'approved_wrappers';
  cross_pot_allowed: number; // 0|1
  approval_required: number; // 0|1
  created_by_run_id: string | null;
  created_by_model_id: string | null;
  prompt_ids_json: string | null;
  role_hash: string | null;
  source_refs_json: string | null;
  test_summary_json: string | null;
  last_run_at: number | null;
  last_success_at: number | null;
  usage_count: number;
  average_rating: number | null;
  created_at: ColumnType<number, number, never>;
  updated_at: number;
}

export interface AgentToolVersionsTable {
  id: string;
  tool_id: string;
  version: number;
  bundle_hash: string | null;
  encrypted_bundle_path: string | null;
  manifest_json: string | null;
  build_report_artifact_id: string | null;
  created_at: ColumnType<number, number, never>;
}

export interface AgentToolRunsTable {
  id: string;
  pot_id: string;
  tool_id: string;
  tool_version: number;
  agent_run_id: string | null;
  snapshot_id: string | null;
  trigger_type: 'manual' | 'heartbeat' | 'bold_auto' | 'user_retry';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  input_payload_json: string | null;
  output_artifact_id: string | null;
  logs_artifact_id: string | null;
  budget_usage_json: string | null;
  started_at: number | null;
  finished_at: number | null;
}

// ── Domain types ────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  pot_id: string;
  enabled: boolean;
  mode: 'quiet' | 'balanced' | 'bold';
  goal_text: string | null;
  cross_pot_enabled: boolean;
  delivery_frequency: string;
  delivery_time_local: string;
  timezone: string;
  max_surprises_per_day: number;
  allow_tool_building: boolean;
  allow_auto_test_low_risk_tools: boolean;
  allow_auto_run_low_risk_tools: boolean;
  quiet_hours: { from: string; to: string } | null;
  created_at: number;
  updated_at: number;
}

export interface AgentRun {
  id: string;
  pot_id: string;
  run_type: 'heartbeat' | 'manual' | 'tool_build' | 'tool_test' | 'tool_run' | 'cross_pot_bridge';
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  schedule_id: string | null;
  snapshot_id: string | null;
  selected_candidate_id: string | null;
  budget_usage: Record<string, unknown>;
  progress: Record<string, unknown>;
  model_id: string | null;
  prompt_ids: string[];
  role_hash: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface AgentCandidate {
  id: string;
  pot_id: string;
  run_id: string | null;
  candidate_type: AgentCandidateType;
  title: string;
  body: string;
  confidence: number;
  novelty: number;
  relevance: number;
  evidence_score: number;
  cost_score: number;
  fatigue_score: number;
  final_score: number;
  status: 'pending' | 'selected' | 'delivered' | 'snoozed' | 'archived' | 'rejected';
  signature: string;
  source_refs: string[];
  launch_payload: Record<string, unknown> | null;
  delivered_at: number | null;
  next_eligible_at: number;
  created_at: number;
}

export interface AgentFeedbackEvent {
  id: string;
  pot_id: string;
  candidate_id: string;
  action: AgentFeedbackAction;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface AgentSchedule {
  id: string;
  pot_id: string;
  enabled: boolean;
  cron_like: string | null;
  timezone: string;
  last_run_id: string | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AgentArtifact {
  id: string;
  pot_id: string;
  run_id: string | null;
  tool_id: string | null;
  artifact_type: AgentArtifactType;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  role_hash: string | null;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface AgentSnapshot {
  id: string;
  pot_id: string;
  run_id: string | null;
  scope: Record<string, unknown>;
  storage_mode: 'temp_sqlite' | 'logical_slice';
  manifest: Record<string, unknown>;
  encrypted_path: string | null;
  status: 'creating' | 'ready' | 'in_use' | 'expired' | 'deleted';
  expires_at: number;
  created_at: number;
  deleted_at: number | null;
}

export interface AgentTool {
  id: string;
  pot_id: string;
  tool_key: string;
  name: string;
  description: string;
  language: 'python' | 'javascript';
  status: AgentToolStatus;
  version: number;
  parent_tool_id: string | null;
  bundle_hash: string | null;
  encrypted_bundle_path: string | null;
  manifest: Record<string, unknown>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  capabilities_required: string[];
  sandbox_policy: Record<string, unknown>;
  network_policy: 'none' | 'approved_wrappers';
  cross_pot_allowed: boolean;
  approval_required: boolean;
  created_by_run_id: string | null;
  created_by_model_id: string | null;
  prompt_ids: string[];
  role_hash: string | null;
  source_refs: string[];
  test_summary: Record<string, unknown> | null;
  last_run_at: number | null;
  last_success_at: number | null;
  usage_count: number;
  average_rating: number;
  created_at: number;
  updated_at: number;
}

export interface AgentToolVersion {
  id: string;
  tool_id: string;
  version: number;
  bundle_hash: string | null;
  encrypted_bundle_path: string | null;
  manifest: Record<string, unknown>;
  build_report_artifact_id: string | null;
  created_at: number;
}

export interface AgentToolRun {
  id: string;
  pot_id: string;
  tool_id: string;
  tool_version: number;
  agent_run_id: string | null;
  snapshot_id: string | null;
  trigger_type: 'manual' | 'heartbeat' | 'bold_auto' | 'user_retry';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  input_payload: Record<string, unknown>;
  output_artifact_id: string | null;
  logs_artifact_id: string | null;
  budget_usage: Record<string, unknown>;
  started_at: number | null;
  finished_at: number | null;
}

// ── Input types ─────────────────────────────────────────────────────────────

export interface UpdateAgentConfigInput {
  enabled?: boolean;
  mode?: 'quiet' | 'balanced' | 'bold';
  goal_text?: string | null;
  cross_pot_enabled?: boolean;
  delivery_frequency?: string;
  delivery_time_local?: string;
  timezone?: string;
  max_surprises_per_day?: number;
  allow_tool_building?: boolean;
  allow_auto_test_low_risk_tools?: boolean;
  allow_auto_run_low_risk_tools?: boolean;
  quiet_hours?: { from: string; to: string } | null;
}

export interface CreateAgentRunInput {
  pot_id: string;
  run_type: AgentRun['run_type'];
  schedule_id?: string;
  model_id?: string;
}

export interface CreateAgentScheduleInput {
  pot_id: string;
  enabled?: boolean;
  cron_like?: string;
  timezone?: string;
  next_run_at?: number;
}

export interface CreateAgentArtifactInput {
  pot_id: string;
  run_id?: string;
  tool_id?: string;
  artifact_type: AgentArtifactType;
  model_id?: string;
  prompt_id?: string;
  prompt_version?: string;
  role_hash?: string;
  payload?: Record<string, unknown>;
}

export interface CreateAgentCandidateInput {
  candidate_type: AgentCandidateType;
  title: string;
  body: string;
  confidence?: number;
  novelty?: number;
  relevance?: number;
  evidence_score?: number;
  cost_score?: number;
  fatigue_score?: number;
  final_score?: number;
  status?: AgentCandidate['status'];
  signature?: string;
  source_refs?: string[];
  launch_payload?: Record<string, unknown> | null;
  next_eligible_at?: number;
}

export interface CreateAgentSnapshotInput {
  pot_id: string;
  run_id?: string;
  scope?: Record<string, unknown>;
  storage_mode?: 'temp_sqlite' | 'logical_slice';
  manifest?: Record<string, unknown>;
  encrypted_path?: string;
  expires_at?: number;
}

export interface CreateAgentToolInput {
  pot_id: string;
  tool_key?: string;
  name: string;
  description?: string;
  language: 'python' | 'javascript';
  bundle_hash?: string;
  encrypted_bundle_path?: string;
  parent_tool_id?: string;
  manifest?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  capabilities_required?: string[];
  sandbox_policy?: Record<string, unknown>;
  network_policy?: 'none' | 'approved_wrappers';
  cross_pot_allowed?: boolean;
  approval_required?: boolean;
  created_by_run_id?: string;
  created_by_model_id?: string;
  prompt_ids?: string[];
  role_hash?: string;
  source_refs?: string[];
}

export interface CreateAgentToolRunInput {
  pot_id: string;
  tool_id: string;
  tool_version?: number;
  agent_run_id?: string;
  snapshot_id?: string;
  trigger_type?: AgentToolRun['trigger_type'];
  input_payload?: Record<string, unknown>;
}

// ── Automation & Heartbeat (044-046) ─────────────────────────────────────────

export interface PotAutomationSettingsTable {
  id: string;
  pot_id: string;
  enabled: number;
  heartbeat_enabled: number;
  agent_task_management_enabled: number;
  agent_can_create_tasks: number;
  agent_can_update_tasks: number;
  agent_can_complete_tasks: number;
  agent_can_render_heartbeat_md: number;
  default_model: string | null;
  timezone: string;
  quiet_hours_json: string;
  run_windows_json: string;
  token_budget_json: string;
  max_tasks_created_per_day: number;
  max_heartbeat_runs_per_day: number;
  proactive_conversations_enabled: ColumnType<number, number, number>;
  proactive_conversation_model: ColumnType<string | null, string | null, string | null>;
  created_at: number;
  updated_at: number;
}

export interface ScheduledTasksTable {
  id: string;
  pot_id: string;
  task_type: string;
  title: string;
  description: string;
  status: string;
  schedule_kind: string;
  cron_like: string | null;
  run_at: number | null;
  timezone: string;
  payload_json: string;
  created_by: string;
  created_from: string;
  last_run_at: number | null;
  next_run_at: number | null;
  last_result_status: string | null;
  last_result_summary: string | null;
  priority: number;
  locked_by: string | null;
  locked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TaskRunsTable {
  id: string;
  task_id: string;
  pot_id: string;
  job_id: string | null;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  result_json: string;
  error_text: string | null;
  created_at: number;
}

export interface HeartbeatSnapshotsTable {
  id: string;
  pot_id: string;
  period_key: string;
  snapshot_json: string;
  summary_json: string;
  open_loops_json: string;
  proposed_tasks_json: string;
  model_id: string | null;
  prompt_id: string | null;
  prompt_version: string | null;
  role_hash: string | null;
  input_fingerprint: string | null;
  created_at: number;
}

export interface HeartbeatDocumentsTable {
  id: string;
  pot_id: string;
  heartbeat_snapshot_id: string;
  format: string;
  content_text: string;
  content_sha256: string | null;
  storage_mode: string;
  file_path: string | null;
  created_at: number;
}

// ── Create input types ─────────────────────────────────────────────────────

export interface CreateScheduledTaskInput {
  pot_id: string;
  task_type?: string;
  title: string;
  description?: string;
  status?: 'active' | 'paused' | 'completed' | 'canceled';
  schedule_kind?: 'cron' | 'once' | 'manual' | 'event';
  cron_like?: string | null;
  run_at?: number | null;
  timezone?: string;
  payload?: Record<string, unknown>;
  created_by?: 'user' | 'system' | 'agent';
  created_from?: 'chat' | 'settings' | 'automation' | 'migration';
  priority?: number;
  next_run_at?: number | null;
}

export interface CreateTaskRunInput {
  task_id: string;
  pot_id: string;
  job_id?: string | null;
  status?: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  model_id?: string | null;
  prompt_id?: string | null;
  prompt_version?: string | null;
}

export interface CreateHeartbeatSnapshotInput {
  pot_id: string;
  period_key: string;
  snapshot: Record<string, unknown>;
  summary: Record<string, unknown>;
  open_loops: unknown[];
  proposed_tasks: unknown[];
  model_id?: string | null;
  prompt_id?: string | null;
  prompt_version?: string | null;
  role_hash?: string | null;
  input_fingerprint?: string | null;
}

export interface CreateHeartbeatDocumentInput {
  pot_id: string;
  heartbeat_snapshot_id: string;
  format?: string;
  content_text: string;
  content_sha256?: string | null;
  storage_mode?: 'db' | 'file' | 'both';
  file_path?: string | null;
}
