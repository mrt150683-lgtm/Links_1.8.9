import { Command } from 'commander';
import { runDoctor, formatDoctorResult } from './commands/doctor.js';
import { setLogLevel, type LogLevel } from '../../logging/logger.js';
import { loadConfig } from '../../config/load.js';
import { openDb } from '../../db/index.js';
import { runForgeMigrations } from '../db/migrate.js';
import { createForgeRunOrchestrator } from '../scout/run_context.js';
import { ingestRepoSeed, ingestIdeaSeed } from '../scout/seed_ingestion.js';
import { runForgeSearch } from '../scout/search.js';
import { runForgeAnalysis } from '../scout/analyze.js';
import { exportForgePacks } from '../export/markdown.js';
import { GitHubClient } from '../../github/client.js';
import path from 'path';

export async function runForgeCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name('forge')
    .description('RepoForge — Multi-repo synergy and starter pack generator')
    .version('0.1.0');

  // doctor command
  program
    .command('doctor')
    .description('Verify Forge config, DB, GitHub auth, and OpenRouter reachability')
    .option('--json', 'Output as JSON (default)', true)
    .option('--verbose', 'Human-readable output', false)
    .action((opts: { json: boolean; verbose: boolean }) => {
      try {
        const config = loadConfig();
        setLogLevel(config.CS_LOG_LEVEL as LogLevel);
      } catch {
        // config errors surfaced in doctor checks
      }
      const result = runDoctor();
      const output = formatDoctorResult(result, opts.verbose);
      console.log(output);
      if (!result.ok) {
        process.exit(1);
      }
    });

  // db subcommand group
  const db = program.command('db').description('Database commands');

  db
    .command('migrate')
    .description('Apply Forge database migrations')
    .action(() => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);
      
      const parsed = path.parse(config.CS_DB_PATH);
      const dbPath = path.join(parsed.dir, `${parsed.name}${config.FORGE_DB_SUFFIX}${parsed.ext}`);
      
      const database = openDb({ path: dbPath });
      try {
        const result = runForgeMigrations(database);
        if (result.applied.length === 0) {
          console.log('No new migrations to apply.');
        } else {
          console.log(`Applied ${result.applied.length} migration(s) to ${dbPath}:`);
          for (const m of result.applied) console.log(`  + ${m}`);
        }
        if (result.skipped.length > 0) {
          console.log(`Skipped ${result.skipped.length} already-applied migration(s).`);
        }
      } finally {
        database.close();
      }
    });

  program
    .command('run')
    .description('Repo Mode: analyze user repo and find complements')
    .requiredOption('--repo <repo>', 'User repository (owner/name)')
    .option('--token <token>', 'Personal GitHub token (optional, uses GITHUB_TOKEN if omitted)')
    .option('--local-readme <path>', 'Path to a local README file to simulate the seed repository')
    .option('--focus <text>', 'Steer discovery toward a specific area (e.g. "visualization")')
    .option('--cheap-model <model>', 'Cheap LLM for keywords', 'x-ai/grok-4.1-fast')
    .option('--premium-model <model>', 'Premium LLM for analysis', 'x-ai/grok-4.1-fast')
    .action(async (opts: { repo: string; token?: string; localReadme?: string; focus?: string; cheapModel: string; premiumModel: string }) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      const ghToken = opts.token || config.GITHUB_TOKEN;
      if (!ghToken) {
        process.stderr.write('Error: GitHub token not provided\n');
        process.exit(1);
      }
      if (!config.OPENROUTER_API_KEY) {
        process.stderr.write('Error: OPENROUTER_API_KEY not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);

      const parsed = path.parse(config.CS_DB_PATH);
      const dbPath = path.join(parsed.dir, `${parsed.name}${config.FORGE_DB_SUFFIX}${parsed.ext}`);
      const database = openDb({ path: dbPath });

      try {
        const orchestrator = createForgeRunOrchestrator(
          database,
          'repo',
          { repo_full_name: opts.repo },
          { repo: opts.repo, cheapModel: opts.cheapModel, premiumModel: opts.premiumModel, localReadme: opts.localReadme, focus: opts.focus },
          config
        );

        const ghClient = new GitHubClient({ token: ghToken, db: database });

        console.log(`Starting Forge run in REPO mode for ${opts.repo}...`);
        
        const seed = await ingestRepoSeed(database, ghClient, orchestrator, {
          repo_full_name: opts.repo,
          model: opts.cheapModel,
          apiKey: config.OPENROUTER_API_KEY,
          localReadmePath: opts.localReadme,
          focus: opts.focus,
        });

        console.log(`Seed ingested. Found ${seed.keywords.length} keywords and ${seed.search_queries.length} queries.`);
        
        console.log('Starting Phase 6: Search & Hydration...');
        const searchResult = await runForgeSearch(database, ghClient, orchestrator, {
          model: opts.cheapModel,
          apiKey: config.OPENROUTER_API_KEY,
          maxQueries: 10,
          maxResultsPerQuery: 10,
        });

        console.log(`Search complete. Found ${searchResult.repos_found} unique repos. Summaries generated: ${searchResult.summaries_generated}`);
        
        console.log('Starting Phase 7: Two-Model Analysis & Pack Generation...');
        const analysisResult = await runForgeAnalysis(database, orchestrator, {
          model: opts.premiumModel,
          apiKey: config.OPENROUTER_API_KEY,
        });

        console.log(`Analysis complete. Generated ${analysisResult.packs_generated} Forge Packs.`);
        console.log(`Run ID: ${orchestrator.run_id}`);
        console.log('Next: Phase 8 (Export & Debug)');

      } finally {
        database.close();
      }
    });

  program
    .command('idea')
    .description('Idea Mode: generate starter packs from a concept')
    .requiredOption('--prompt <prompt>', 'Raw idea or concept')
    .option('--focus <text>', 'Steer discovery toward a specific area')
    .option('--cheap-model <model>', 'Cheap LLM for keywords', 'x-ai/grok-4.1-fast')
    .option('--premium-model <model>', 'Premium LLM for analysis', 'x-ai/grok-4.1-fast')
    .action(async (opts: { prompt: string; focus?: string; cheapModel: string; premiumModel: string }) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      if (!config.OPENROUTER_API_KEY) {
        process.stderr.write('Error: OPENROUTER_API_KEY not set\n');
        process.exit(1);
      }
      if (!config.GITHUB_TOKEN) {
        process.stderr.write('Error: GITHUB_TOKEN not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);

      const parsed = path.parse(config.CS_DB_PATH);
      const dbPath = path.join(parsed.dir, `${parsed.name}${config.FORGE_DB_SUFFIX}${parsed.ext}`);
      const database = openDb({ path: dbPath });

      try {
        const orchestrator = createForgeRunOrchestrator(
          database,
          'idea',
          { text: opts.prompt },
          { prompt: opts.prompt, focus: opts.focus, cheapModel: opts.cheapModel, premiumModel: opts.premiumModel },
          config
        );

        console.log(`Starting Forge run in IDEA mode for: "${opts.prompt}"...`);
        if (opts.focus) console.log(`Focus: ${opts.focus}`);
        
        const seed = await ingestIdeaSeed(database, orchestrator, {
          prompt: opts.prompt,
          focus: opts.focus,
          model: opts.cheapModel,
          apiKey: config.OPENROUTER_API_KEY,
        });

        console.log(`Seed ingested. Found ${seed.keywords.length} keywords and ${seed.search_queries.length} queries.`);
        
        const ghClient = new GitHubClient({ token: config.GITHUB_TOKEN!, db: database });
        console.log('Starting Phase 6: Search & Hydration...');
        const searchResult = await runForgeSearch(database, ghClient, orchestrator, {
          model: opts.cheapModel,
          apiKey: config.OPENROUTER_API_KEY,
          maxQueries: 10,
          maxResultsPerQuery: 10,
        });

        console.log(`Search complete. Found ${searchResult.repos_found} unique repos. Summaries generated: ${searchResult.summaries_generated}`);
        
        console.log('Starting Phase 7: Two-Model Analysis & Pack Generation...');
        const analysisResult = await runForgeAnalysis(database, orchestrator, {
          model: opts.premiumModel,
          apiKey: config.OPENROUTER_API_KEY,
        });

        console.log(`Analysis complete. Generated ${analysisResult.packs_generated} Forge Packs.`);
        console.log(`Run ID: ${orchestrator.run_id}`);
        console.log('Next: Phase 8 (Export & Debug)');

      } finally {
        database.close();
      }
    });

  program
    .command('export')
    .description('Export Forge Packs to Markdown')
    .requiredOption('--run-id <runId>', 'Run ID')
    .requiredOption('--out <dir>', 'Output directory')
    .action(async (opts: { runId: string; out: string }) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);

      const parsed = path.parse(config.CS_DB_PATH);
      const dbPath = path.join(parsed.dir, `${parsed.name}${config.FORGE_DB_SUFFIX}${parsed.ext}`);
      const database = openDb({ path: dbPath });

      try {
        const orchestrator = createForgeRunOrchestrator(database, 'idea', {}, {}, config);
        // Force the run_id
        (orchestrator as any).run_id = opts.runId;
        (orchestrator as any).forge_run_id = opts.runId;

        console.log(`Exporting packs for run ${opts.runId} to ${opts.out}...`);
        const result = await exportForgePacks(database, orchestrator, { outDir: opts.out });
        console.log(`Export complete. Exported ${result.packs_exported} packs to ${result.outDir}.`);
      } finally {
        database.close();
      }
    });

  await program.parseAsync(argv);
}
