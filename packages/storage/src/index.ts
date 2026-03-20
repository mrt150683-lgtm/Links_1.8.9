// Database connection
export { initDatabase, getDatabase, getSqliteInstance, closeDatabase, isDatabaseInitialized } from './db.js';
export type { DatabaseConfig } from './db.js';

// Migrations
export { runMigrations, getMigrationStatus } from './migrations.js';

// Canonicalization
export { canonicalizeText, hashText } from './canonicalize.js';

// Phase 4: Encryption and asset storage
export * from './encryption.js';
export * from './assetStore.js';

// Phase 9: Bundle export/import
export * from './bundleManifest.js';
export * from './bundleEncryption.js';
export * from './bundleFormat.js';
export * from './bundleTemp.js';
export * from './idRemapper.js';
export * from './publicModeTransform.js';
export * from './bundleExporter.js';
export * from './bundleImporter.js';

// Phase 5: Job processing
export * from './backoff.js';
export * from './job-types.js';

// Repositories
export * from './repos/potsRepo.js';
export * from './repos/entriesRepo.js';
export * from './repos/assetsRepo.js'; // Phase 4
export * from './repos/auditRepo.js';
export * from './repos/prefsRepo.js';
export * from './repos/jobsRepo.js'; // Phase 5
export * from './repos/modelsRepo.js'; // Phase 6
export * from './repos/artifactsRepo.js'; // Phase 7
export * from './repos/linkCandidatesRepo.js'; // Phase 8
export * from './repos/linksRepo.js'; // Phase 8
export * from './repos/extTokenRepo.js'; // Phase 11
export * from './repos/searchRepo.js'; // Phase 12
export * from './repos/diagnosticsRepo.js'; // Phase 12
export * from './repos/intelligenceRepo.js'; // intel-gen
export * from './repos/journalRepo.js'; // journal module
export * from './repos/planningRepo.js'; // planning module
// deep research (021)
export * from './repos/researchArtifactsRepo.js';
export * from './repos/researchRunsRepo.js';
export * from './repos/researchNotificationsRepo.js';
export * from './repos/researchSchedulesRepo.js';
// chat (024)
export * from './repos/chatRepo.js';
// main chat (026)
export * from './repos/mainChatRepo.js';
// main chat notifications (027)
export * from './repos/mainChatNotificationsRepo.js';
// browser (028)
export * from './repos/browserRepo.js';
// calendar (029)
export * from './repos/calendarRepo.js';
// dyk (030)
export * from './repos/dykRepo.js';
export * from './repos/onboardingRepo.js';
// flow correlation (031/032)
export * from './repos/flowRunsRepo.js';
// mom chat (033)
export * from './repos/chatRunsRepo.js';
// voice addon (034)
export * from './repos/voiceSettingsRepo.js';
export * from './repos/voiceVoicesRepo.js';
export * from './repos/voiceSessionsRepo.js';
// entry translations (035)
export * from './repos/translationsRepo.js';
// nutrition module (036)
export * from './repos/nutritionRepo.js';
export * from './nutrition/provisionDietPot.js';
export * from './nutrition/nutritionProfilePrefs.js';
// wellness addon (037)
export * from './repos/nutritionWellbeingRepo.js';
export * from './repos/nutritionSupplementRepo.js';
// rss module (038)
export * from './repos/rssRepo.js';
// agent core (040-043)
export * from './repos/agentRepo.js';
export * from './repos/agentCandidatesRepo.js';
export * from './repos/agentSnapshotsRepo.js';
export * from './repos/agentToolsRepo.js';
// automation & heartbeat (044-046)
export * from './repos/automationRepo.js';
export * from './repos/scheduledTasksRepo.js';
export * from './repos/heartbeatRepo.js';
export * from './repos/taskRunsRepo.js';
export { parseCronLikeDescription } from './lib/cronUtils.js';

// Journal module: runtime value (not a type)
export { DEFAULT_JOURNAL_CONFIG } from './types.js';

// Agent input types
export type {
  CreateAgentCandidateInput,
  CreateAgentToolInput,
  CreateAgentToolRunInput,
  CreateAgentRunInput,
  CreateAgentScheduleInput,
  CreateAgentSnapshotInput,
  UpdateAgentConfigInput,
  CreateAgentArtifactInput,
} from './types.js';

// Automation input types
export type {
  CreateScheduledTaskInput,
  CreateTaskRunInput,
  CreateHeartbeatSnapshotInput,
  CreateHeartbeatDocumentInput,
} from './types.js';

// Agent roles (018_pot_role)
export * from './roleFiles.js';

// Utilities
export { toDateKey, getSystemTimezone, todayDateKey } from './utils/dateKey.js';

// Types
export type {
  Pot,
  Entry,
  Asset, // Phase 4
  AuditEvent,
  CreatePotInput,
  UpdatePotInput,
  CreateTextEntryInput,
  CreateAssetEntryInput, // Phase 4
  CreateAssetInput, // Phase 4
  ListEntriesFilters,
  CapturePreferences,
  CreateTextEntryIdempotentInput,
  CaptureResult,
  EntryWithAsset, // Phase 4
  ProcessingJob, // Phase 5
  AiModel, // Phase 6
  AiPreferences, // Phase 6
  DerivedArtifact, // Phase 7
  CreateArtifactInput, // Phase 7
  LinkCandidate, // Phase 8
  Link, // Phase 8
  LinkEvidence, // Phase 8
  ExportPotOptions, // Phase 9
  ImportPotOptions, // Phase 9
  ExportResult, // Phase 9
  ImportResult, // Phase 9
  ExtensionToken, // Phase 11
  CreateLinkEntryInput, // Phase 11
  // intel-gen
  IntelligenceRun,
  IntelligenceQuestion,
  IntelligenceAnswer,
  IntelAnswerEvidence,
  CreateIntelligenceRunInput,
  CreateIntelligenceQuestionInput,
  CreateIntelligenceAnswerInput,
  // journal module
  JournalEntry,
  CreateJournalEntryInput,
  JournalJobPayload,
  JournalConfig,
  JournalBudgetConfig,
  ProcessingConfig,
  // planning module
  PlanningRun,
  PlanningRunStatus,
  PlanningAnswer,
  PlanningFile,
  PlanningFileProvenance,
  LoggingPreferences,
  // deep research
  ResearchRun,
  ResearchRunStatus,
  ResearchArtifact,
  ResearchArtifactType,
  ResearchSchedule,
  ResearchNotification,
  ResearchNotificationType,
  CreateResearchRunInput,
  CreateResearchArtifactInput,
  CreateResearchScheduleInput,
  CreateResearchNotificationInput,
  // chat
  ChatThread,
  ChatMessageRecord,
  // main chat
  MainChatThread,
  MainChatMessageRecord,
  MainChatNotification,
  MainChatNotificationType,
  MainChatNotificationState,
  CreateMainChatNotificationInput,
  // calendar
  CalendarEvent,
  CalendarEntryDate,
  CalendarNotification,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  UpsertCalendarEntryDateInput,
  CreateCalendarNotificationInput,
  CalendarRangeResult,
  CalendarDateResult,
  CalendarSearchResult,
  // dyk
  DykItem,
  DykFeedbackEvent,
  DykNotification,
  DykState,
  DykListOptions,
  DykStatus,
  DykSourceType,
  CreateDykItemInput,
  CreateDykFeedbackEventInput,
  CreateDykNotificationInput,
  UpsertOnboardingInput,
  PotOnboarding,
  OnboardingCompleteRequestSchema,
  PotSettingsUpdateSchema,
  HistoryItem,
  // flow correlation
  FlowRun,
  CreateFlowRunInput,
  // mom chat
  ChatRun,
  ChatRunAgent,
  ChatRunReview,
  ChatRunExecutionMode,
  ChatRunStatus,
  ChatRunAgentStatus,
  CreateChatRunInput,
  CreateChatRunAgentInput,
  CreateChatRunReviewInput,
  // voice addon
  VoiceSettings,
  VoiceVoice,
  VoiceSession,
  VoiceSessionEvent,
  VoiceQuality,
  VoiceEngineType,
  VoiceSessionStatus,
  UpdateVoiceSettingsInput,
  CreateVoiceSessionInput,
  UpsertVoiceVoiceInput,
  // entry translations
  EntryTranslation,
  EntryTranslationSummary,
  UpsertTranslationInput,
  // nutrition module
  NutritionMeal,
  NutritionDailyReview,
  NutritionWeeklyCheckIn,
  NutritionWeeklyReview,
  NutritionRecipe,
  CreateNutritionMealInput,
  CreateNutritionRecipeInput,
  // rss module
  RssFeed,
  RssArticle,
  RssFeedSuggestion,
  RssSettings,
  CreateRssFeedInput,
  UpdateRssFeedInput,
  UpsertRssArticleInput,
  CreateRssFeedSuggestionInput,
} from './types.js';
