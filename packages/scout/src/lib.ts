/**
 * @links/scout — Library entry point.
 *
 * Re-exports the core Scout + Forge APIs for use by other workspace packages
 * (e.g. @links/api). CLI-only code (commander, dotenv) is NOT exported.
 */

// ── Database ────────────────────────────────────────────────────────────────
export { openDb, closeDb, withTransaction } from './db/index.js';
export type { Db, OpenDbOptions } from './db/index.js';

export { runMigrations, setMigrationsDir, getSchemaVersion, getLatestMigration } from './db/migrate.js';
export type { MigrateResult } from './db/migrate.js';

export { runForgeMigrations, setForgeMigrationsDir } from './forge/db/migrate.js';

// ── Path overrides (for bundled / Electron builds) ──────────────────────────
export { setPromptsDir } from './llm/prompt_registry.js';
export { setScoringDir } from './llm/scoring.js';

// ── Prompts & LLM ──────────────────────────────────────────────────────────
export { loadPrompt, fillTemplate } from './llm/prompt_registry.js';
export type { PromptMeta, PromptModelDefaults, LoadedPrompt } from './llm/prompt_registry.js';

export { callOpenRouter, callOpenRouterJson } from './llm/client.js';
export { loadScoringPolicy, computeSignalsBonus, computeFinalScore } from './llm/scoring.js';
export type { ScoringPolicy, ScoringWeights, SignalsBonus, ScoringThresholds } from './llm/scoring.js';

// ── Scout operations ────────────────────────────────────────────────────────
export { runPass1 } from './scout/pass1.js';
export { runAnalysis } from './scout/analyze.js';
export { createRunOrchestrator } from './scout/run_context.js';
export type { RunOrchestrator, StepHandle } from './scout/run_context.js';

// ── Briefs ──────────────────────────────────────────────────────────────────
export { generateBriefs } from './briefs/generator.js';

// ── Forge operations ────────────────────────────────────────────────────────
export { ingestRepoSeed, ingestIdeaSeed } from './forge/scout/seed_ingestion.js';
export { runForgeSearch } from './forge/scout/search.js';
export { runForgeAnalysis } from './forge/scout/analyze.js';
export { createForgeRunOrchestrator } from './forge/scout/run_context.js';
export type { ForgeRunOrchestrator } from './forge/scout/run_context.js';

// ── DAOs ────────────────────────────────────────────────────────────────────
export { RunsDao } from './db/dao/runs.js';
export { StepsDao } from './db/dao/steps.js';
export { BriefsDao } from './db/dao/briefs.js';
export { AnalysesDao, KeywordsDao } from './db/dao/analyses.js';
export { ReposDao, ReadmesDao, GithubQueriesDao } from './db/dao/repos.js';
export { ForgeRunsDao } from './forge/db/dao/forge_runs.js';
export { ForgePacksDao } from './forge/db/dao/forge_packs.js';

// ── GitHub client ───────────────────────────────────────────────────────────
export { GitHubClient } from './github/client.js';
export type { GitHubClientOptions } from './github/client.js';

// ── Config schema ───────────────────────────────────────────────────────────
export { ConfigSchema } from './config/schema.js';
export type { Config } from './config/schema.js';
