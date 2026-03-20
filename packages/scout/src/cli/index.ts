import { Command } from 'commander';
import { runDoctor, formatDoctorResult } from './commands/doctor.js';
import { setLogLevel, type LogLevel } from '../logging/logger.js';
import { loadConfig } from '../config/load.js';
import { openDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runDry } from '../scout/dry_run.js';
import { runPass1 } from '../scout/pass1.js';
import { runAnalysis } from '../scout/analyze.js';
import { GitHubClient } from '../github/client.js';
import { generateBriefs } from '../briefs/generator.js';
import { exportMarkdown } from '../export/markdown.js';
import { createRunOrchestrator } from '../scout/run_context.js';

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name('scout')
    .description('Collaboration Scout — GitHub repository discovery and brief generation')
    .version('0.1.0');

  // doctor command
  program
    .command('doctor')
    .description('Verify config, DB, GitHub auth, and OpenRouter reachability')
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

  // scout subcommand group
  const scout = program.command('scout').description('Scout commands');

  scout
    .command('run')
    .description('Pass 1: search GitHub, hydrate READMEs, analyze with LLM')
    .requiredOption('--query <query>', 'Search query')
    .option('--days <days>', 'Days since last push', '180')
    .option('--stars <stars>', 'Minimum star count', '50')
    .option('--max-stars <maxStars>', 'Maximum star count (skip overly popular repos)')
    .option('--top <top>', 'Max repos to fetch', '100')
    .option('--lang <lang>', 'Language filter')
    .option('--include-forks', 'Include forked repos', false)
    .option('--model <model>', 'LLM model for analysis', 'x-ai/grok-4.1-fast')
    .option('--dry', 'Dry run using fixtures (no network)', false)
    .action(async (opts: {
      query: string;
      days: string;
      stars: string;
      maxStars?: string;
      top: string;
      lang?: string;
      includeForks?: boolean;
      model: string;
      dry?: boolean;
    }) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);
      const database = openDb({ path: config.CS_DB_PATH });

      // Dry mode: use fixtures, no network
      if (opts.dry) {
        try {
          const result = runDry(database, { query: opts.query });
          console.log(JSON.stringify({ ok: true, run_id: result.run_id, steps: result.steps, repos_found: result.repos_found }, null, 2));
        } finally {
          database.close();
        }
        return;
      }

      // Real mode: GitHub + LLM
      if (!config.GITHUB_TOKEN) {
        process.stderr.write('Error: GITHUB_TOKEN is not set\n');
        process.exit(1);
      }
      if (!config.OPENROUTER_API_KEY) {
        process.stderr.write('Error: OPENROUTER_API_KEY is not set\n');
        process.exit(1);
      }

      try {
        const orchestrator = createRunOrchestrator(database, { query: opts.query }, {});
        const ghClient = new GitHubClient({ token: config.GITHUB_TOKEN, db: database });

        // Pass 1: search + hydrate
        const pass1 = await runPass1(database, ghClient, orchestrator, {
          query: opts.query,
          days: parseInt(opts.days, 10),
          stars: parseInt(opts.stars, 10),
          maxStars: opts.maxStars ? parseInt(opts.maxStars, 10) : undefined,
          topN: parseInt(opts.top, 10),
          language: opts.lang,
          includeForks: opts.includeForks,
        });

        // Analyze with LLM
        const analysis = await runAnalysis(database, orchestrator, {
          model: opts.model,
          apiKey: config.OPENROUTER_API_KEY,
        });

        console.log(JSON.stringify({
          ok: true,
          run_id: orchestrator.run_id,
          model: opts.model,
          repos_found: pass1.repos_found,
          repos_stored: pass1.repos_stored,
          readmes_fetched: pass1.readmes_fetched,
          readmes_missing: pass1.readmes_missing,
          analyzed: analysis.analyzed,
          keywords_stored: analysis.keywords_stored,
          failed: analysis.failed,
        }, null, 2));
      } finally {
        database.close();
      }
    });

  scout
    .command('expand')
    .description('Pass 2: keyword expansion')
    .requiredOption('--run-id <runId>', 'Run ID to expand')
    .option('--pass2-stars <stars>', 'Stars threshold for pass 2', '15')
    .option('--pass2-max-stars <maxStars>', 'Max stars for pass 2 (excludes overly popular repos)')
    .option('--max-queries <n>', 'Max generated queries', '10')
    .action((_opts) => {
      process.stderr.write('scout:expand not yet implemented (Phase 7)\n');
      process.exit(1);
    });

  // briefs subcommand group
  const briefs = program.command('briefs').description('Brief commands');

  briefs
    .command('generate')
    .description('Generate collaboration briefs')
    .requiredOption('--run-id <runId>', 'Run ID')
    .option('--min-score <score>', 'Minimum brief score', '0.75')
    .option('--max-briefs <n>', 'Max briefs to generate', '20')
    .option('--overlap-threshold <n>', 'Functional overlap threshold for competitor filtering (0–1)')
    .option('--overlap-penalty <n>', 'Exception penalty for interop-tagged competitor pairs')
    .option('--history-candidates <n>', 'Max historical repos from previous runs to inject (0 = disabled)')
    .option('--own-repo <owner/repo>', 'Your own repo (e.g. myorg/myrepo) — exempt from diversity dedup so it appears in every brief')
    .action(async (opts: { runId: string; minScore?: string; maxBriefs?: string; overlapThreshold?: string; overlapPenalty?: string; historyCandidates?: string; ownRepo?: string }) => {
      const config = loadConfig();
      if (!config.OPENROUTER_API_KEY) {
        process.stderr.write('Error: OPENROUTER_API_KEY is not set\n');
        process.exit(1);
      }
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);
      const database = openDb({ path: config.CS_DB_PATH });
      try {
        const orchestrator = createRunOrchestrator(database, {}, {});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any
        (orchestrator as any).run_id = opts.runId;
        const result = await generateBriefs(database, orchestrator, {
          model: 'x-ai/grok-4.1-fast',
          apiKey: config.OPENROUTER_API_KEY,
          minBriefScore: opts.minScore ? parseFloat(opts.minScore) : 0.75,
          maxBriefs: opts.maxBriefs ? parseInt(opts.maxBriefs, 10) : 20,
          overlapThreshold: opts.overlapThreshold ? parseFloat(opts.overlapThreshold) : config.CS_OVERLAP_THRESHOLD,
          overlapExceptionPenalty: opts.overlapPenalty ? parseFloat(opts.overlapPenalty) : config.CS_OVERLAP_EXCEPTION_PENALTY,
          historyCandidates: opts.historyCandidates ? parseInt(opts.historyCandidates, 10) : config.CS_HISTORY_CANDIDATES,
          ownRepo: opts.ownRepo,
        });
        console.log(JSON.stringify(result, null, 2));
      } finally {
        database.close();
      }
    });

  briefs
    .command('export')
    .description('Export briefs to Markdown')
    .requiredOption('--run-id <runId>', 'Run ID')
    .requiredOption('--out <dir>', 'Output directory')
    .option('--top-opportunities <n>', 'Number of top briefs to export as ranked files', '3')
    .action(async (opts: { runId: string; out: string; topOpportunities?: string }) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      setLogLevel(config.CS_LOG_LEVEL as LogLevel);
      const database = openDb({ path: config.CS_DB_PATH });
      try {
        const orchestrator = createRunOrchestrator(database, {}, {});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-explicit-any
        (orchestrator as any).run_id = opts.runId;
        const result = await exportMarkdown(database, orchestrator, {
          outDir: opts.out,
          topOpportunities: opts.topOpportunities ? parseInt(opts.topOpportunities, 10) : config.CS_TOP_OPPORTUNITIES,
        });
        console.log(JSON.stringify(result, null, 2));
      } finally {
        database.close();
      }
    });

  // debug subcommand group
  const debug = program.command('debug').description('Debug commands');

  debug
    .command('replay')
    .description('Replay scoring offline')
    .requiredOption('--run-id <runId>', 'Run ID')
    .action((_opts) => {
      process.stderr.write('debug:replay not yet implemented (Phase 9)\n');
      process.exit(1);
    });

  debug
    .command('dump-run')
    .description('Export full run artifact bundle')
    .requiredOption('--run-id <runId>', 'Run ID')
    .action((_opts) => {
      process.stderr.write('debug:dump-run not yet implemented (Phase 6+)\n');
      process.exit(1);
    });

  // db subcommand group
  const db = program.command('db').description('Database commands');

  db
    .command('migrate')
    .description('Apply database migrations')
    .action((_opts) => {
      const config = loadConfig();
      if (!config.CS_DB_PATH) {
        process.stderr.write('Error: CS_DB_PATH is not set\n');
        process.exit(1);
      }
      const database = openDb({ path: config.CS_DB_PATH });
      try {
        const result = runMigrations(database);
        if (result.applied.length === 0) {
          console.log('No new migrations to apply.');
        } else {
          console.log(`Applied ${result.applied.length} migration(s):`);
          for (const m of result.applied) console.log(`  + ${m}`);
        }
        if (result.skipped.length > 0) {
          console.log(`Skipped ${result.skipped.length} already-applied migration(s).`);
        }
      } finally {
        database.close();
      }
    });

  db
    .command('vacuum')
    .description('Compact the database file')
    .action((_opts) => {
      process.stderr.write('db:vacuum not yet implemented (Phase 9)\n');
      process.exit(1);
    });

  // cache subcommand group
  program
    .command('cache')
    .description('Cache management')
    .command('prune')
    .option('--days <days>', 'Remove entries older than N days', '30')
    .action((_opts) => {
      process.stderr.write('cache:prune not yet implemented (Phase 9)\n');
      process.exit(1);
    });

  // logs subcommand group
  program
    .command('logs')
    .description('Log management')
    .command('prune')
    .option('--days <days>', 'Remove logs older than N days', '90')
    .action((_opts) => {
      process.stderr.write('logs:prune not yet implemented (Phase 9)\n');
      process.exit(1);
    });

  await program.parseAsync(argv);
}
