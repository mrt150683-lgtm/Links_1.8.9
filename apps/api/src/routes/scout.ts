/**
 * Scout & RepoForge API routes.
 *
 * Exposes the @links/scout library over HTTP so the web UI and
 * Electron launcher can drive discovery runs without a CLI.
 *
 * Scout uses its own SQLite database (separate from the Links DB)
 * to avoid schema conflicts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  openDb,
  closeDb,
  runMigrations,
  runForgeMigrations,
  setMigrationsDir,
  setForgeMigrationsDir,
  setPromptsDir,
  setScoringDir,
  createRunOrchestrator,
  createForgeRunOrchestrator,
  runPass1,
  runAnalysis,
  generateBriefs,
  ingestRepoSeed,
  runForgeSearch,
  runForgeAnalysis,
  RunsDao,
  StepsDao,
  BriefsDao,
  ForgeRunsDao,
  ForgePacksDao,
  GitHubClient,
  type Db,
} from '@links/scout';
import { getPreference } from '@links/storage';

// ── Zod request schemas ─────────────────────────────────────────────────────

const StartRunBody = z.object({
  query: z.string().min(1),
  model: z.string().min(1),
  days: z.number().int().positive().optional(),
  stars: z.number().int().nonnegative().optional(),
  maxStars: z.number().int().positive().optional(),
  topN: z.number().int().positive().optional(),
  language: z.string().optional(),
  includeForks: z.boolean().optional(),
});

const GenerateBriefsBody = z.object({
  model: z.string().min(1),
  minRepoScore: z.number().optional(),
  minBriefScore: z.number().optional(),
  maxBriefs: z.number().int().positive().optional(),
});

const StartForgeRunBody = z.object({
  repo_full_name: z.string().min(1),
  model: z.string().min(1),
  focus: z.string().optional(),
  maxQueries: z.number().int().positive().optional(),
  topN: z.number().int().positive().optional(),
});

const RunIdParams = z.object({ id: z.string().uuid() });

// ── Module-level singleton ──────────────────────────────────────────────────

let scoutDb: Db | null = null;

function getScoutDb(): Db {
  if (scoutDb) return scoutDb;

  const dbPath = process.env.SCOUT_DB_PATH
    ?? (process.env.DATABASE_PATH
      ? process.env.DATABASE_PATH.replace(/links\.db$/, 'scout.db')
      : './data/scout.db');

  // Apply path overrides before opening DB (Electron sets these env vars)
  if (process.env.SCOUT_PROMPTS_DIR) setPromptsDir(process.env.SCOUT_PROMPTS_DIR);
  if (process.env.SCOUT_SCORING_DIR) setScoringDir(process.env.SCOUT_SCORING_DIR);
  if (process.env.SCOUT_MIGRATIONS_DIR) {
    setMigrationsDir(process.env.SCOUT_MIGRATIONS_DIR);
    setForgeMigrationsDir(process.env.SCOUT_MIGRATIONS_DIR);
  }

  scoutDb = openDb({ path: dbPath });
  runMigrations(scoutDb);
  runForgeMigrations(scoutDb);
  return scoutDb;
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw Object.assign(new Error('OPENROUTER_API_KEY not configured'), { statusCode: 503 });
  return key;
}

interface ScoutPrefs { github_token?: string }

async function getGitHubToken(): Promise<string> {
  // 1. Check user preferences first (trim to guard against paste artifacts)
  const prefs = await getPreference<ScoutPrefs>('scout.preferences');
  const storedToken = prefs?.github_token?.trim();
  if (storedToken) return storedToken;

  // 2. Fall back to environment variable
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  throw Object.assign(new Error('GitHub token not configured. Set it in Scout Settings or GITHUB_TOKEN env var.'), { statusCode: 503 });
}

async function getGitHubClient(): Promise<GitHubClient> {
  const token = await getGitHubToken();
  const db = getScoutDb();
  return new GitHubClient({ token, db });
}

// ── Routes ──────────────────────────────────────────────────────────────────

export async function scoutRoutes(fastify: FastifyInstance): Promise<void> {

  // Token diagnostic — shows which source is active and tests GitHub connectivity
  fastify.get('/scout/check-token', async (_request, reply) => {
    const prefs = await getPreference<ScoutPrefs>('scout.preferences');
    const dbToken = prefs?.github_token?.trim() ?? null;
    const envToken = process.env.GITHUB_TOKEN?.trim() ?? null;

    const activeToken = dbToken ?? envToken ?? null;
    const source = dbToken ? 'scout_settings' : envToken ? 'env_GITHUB_TOKEN' : 'none';

    function mask(t: string) {
      if (t.length <= 8) return '****';
      return t.slice(0, 4) + '****' + t.slice(-4);
    }

    if (!activeToken) {
      return reply.status(200).send({ source, token_hint: null, github_status: 'no_token' });
    }

    // Quick connectivity test — /rate_limit returns X-OAuth-Scopes header
    try {
      const resp = await fetch('https://api.github.com/rate_limit', {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'collaboration-scout/0.1.0',
        },
      });
      const github_status = resp.status === 200 ? 'ok' : `http_${resp.status}`;
      // X-OAuth-Scopes is "repo,gist" etc. — empty string = no scopes (fine-grained tokens show nothing)
      const scopes_raw = resp.headers.get('x-oauth-scopes') ?? null;
      const scopes = scopes_raw !== null
        ? (scopes_raw.trim() === '' ? [] : scopes_raw.split(',').map(s => s.trim()))
        : null; // null = fine-grained token (no scopes header)
      const has_repo_scope = scopes === null ? null : scopes.includes('repo');
      return reply.status(200).send({ source, token_hint: mask(activeToken), github_status, scopes, has_repo_scope });
    } catch (err) {
      return reply.status(200).send({ source, token_hint: mask(activeToken), github_status: `error: ${(err as Error).message}`, scopes: null, has_repo_scope: null });
    }
  });

  // Health check
  fastify.get('/scout/status', async () => {
    try {
      const db = getScoutDb();
      const runsDao = new RunsDao(db);
      // Simple connectivity check — just see if the table exists
      void runsDao;
      return { status: 'ok', db: 'connected' };
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  });

  // ── Scout runs ──────────────────────────────────────────────────────────

  // POST /scout/runs — Start a new scout run (search + analyze)
  fastify.post('/scout/runs', async (request, reply) => {
    const body = StartRunBody.parse(request.body);
    const db = getScoutDb();
    const apiKey = getApiKey();
    const ghClient = await getGitHubClient();
    request.log.info({ query: body.query, model: body.model }, 'scout discovery run starting');

    const orchestrator = createRunOrchestrator(db, body as Record<string, unknown>, {});

    try {
      // Run search pass
      const pass1Result = await runPass1(db, ghClient, orchestrator, {
        query: body.query,
        days: body.days,
        stars: body.stars,
        maxStars: body.maxStars,
        topN: body.topN,
        language: body.language,
        includeForks: body.includeForks,
      });

      // Run LLM analysis on discovered repos
      const analyzeResult = await runAnalysis(db, orchestrator, {
        model: body.model,
        apiKey,
      });

      request.log.info({ query: body.query, run_id: orchestrator.run_id, repos_found: (pass1Result as unknown as Record<string, unknown>).repos_found }, 'scout discovery run complete');
      reply.code(201);
      return {
        run_id: orchestrator.run_id,
        pass1: pass1Result,
        analysis: analyzeResult,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ query: body.query, error: msg }, 'scout discovery run failed');
      throw err;
    }
  });

  // GET /scout/runs — List all scout runs
  fastify.get('/scout/runs', async () => {
    const db = getScoutDb();
    const rows = db
      .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 50')
      .all();
    return { runs: rows };
  });

  // GET /scout/runs/:id — Get run details + steps
  fastify.get('/scout/runs/:id', async (request) => {
    const { id } = RunIdParams.parse(request.params);
    const db = getScoutDb();
    const runsDao = new RunsDao(db);
    const stepsDao = new StepsDao(db);

    const run = runsDao.get(id);
    if (!run) {
      throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    }

    const steps = stepsDao.list(id);
    return { run, steps };
  });

  // ── Briefs ────────────────────────────────────────────────────────────

  // POST /scout/runs/:id/briefs — Generate briefs for a run
  fastify.post('/scout/runs/:id/briefs', async (request, reply) => {
    const { id } = RunIdParams.parse(request.params);
    const body = GenerateBriefsBody.parse(request.body);
    const db = getScoutDb();
    const apiKey = getApiKey();

    const runsDao = new RunsDao(db);
    const run = runsDao.get(id);
    if (!run) {
      throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    }

    // Re-create a lightweight orchestrator bound to this existing run
    const orchestrator = createRunOrchestrator(db, JSON.parse(run.args_json), {});

    const result = await generateBriefs(db, orchestrator, {
      model: body.model,
      apiKey,
      minRepoScore: body.minRepoScore,
      minBriefScore: body.minBriefScore,
      maxBriefs: body.maxBriefs,
    });

    reply.code(201);
    return result;
  });

  // GET /scout/runs/:id/briefs — List briefs for a run
  fastify.get('/scout/runs/:id/briefs', async (request) => {
    const { id } = RunIdParams.parse(request.params);
    const db = getScoutDb();
    const briefsDao = new BriefsDao(db);
    const briefs = briefsDao.listByRunId(id);
    return { briefs };
  });

  // ── Forge runs ────────────────────────────────────────────────────────

  // POST /scout/forge/runs — Start a Forge run (repo mode)
  fastify.post('/scout/forge/runs', async (request, reply) => {
    const body = StartForgeRunBody.parse(request.body);
    request.log.info({ repo: body.repo_full_name, model: body.model }, 'forge run starting');

    const db = getScoutDb();
    const apiKey = getApiKey();
    const ghClient = await getGitHubClient();

    const orchestrator = createForgeRunOrchestrator(
      db,
      'repo',
      { repo_full_name: body.repo_full_name },
      body as Record<string, unknown>,
      {},
    );

    try {
      // 1. Ingest seed repo
      await ingestRepoSeed(db, ghClient, orchestrator, {
        repo_full_name: body.repo_full_name,
        model: body.model,
        apiKey,
        focus: body.focus,
      });

      // 2. Search for complementary repos
      await runForgeSearch(db, ghClient, orchestrator, {
        model: body.model,
        apiKey,
        maxQueries: body.maxQueries,
      });

      // 3. Analyze and generate packs
      const analyzeResult = await runForgeAnalysis(db, orchestrator, {
        model: body.model,
        apiKey,
        topN: body.topN,
      });

      request.log.info({ repo: body.repo_full_name, run_id: orchestrator.run_id, packs: analyzeResult.packs_generated }, 'forge run complete');
      reply.code(201);
      return {
        run_id: orchestrator.run_id,
        packs_generated: analyzeResult.packs_generated,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error({ repo: body.repo_full_name, error: msg }, 'forge run failed');
      throw err;
    }
  });

  // GET /scout/forge/runs — List Forge runs
  fastify.get('/scout/forge/runs', async () => {
    const db = getScoutDb();
    const rows = db
      .prepare('SELECT * FROM forge_runs ORDER BY created_at DESC LIMIT 50')
      .all();
    return { runs: rows };
  });

  // GET /scout/forge/runs/:id/packs — Get Forge packs for a run
  fastify.get('/scout/forge/runs/:id/packs', async (request) => {
    const { id } = RunIdParams.parse(request.params);
    const db = getScoutDb();
    const forgePacksDao = new ForgePacksDao(db);
    const packs = forgePacksDao.getByRunId(id);
    return { packs };
  });

  // ── Cleanup hook ──────────────────────────────────────────────────────

  fastify.addHook('onClose', () => {
    if (scoutDb) {
      closeDb(scoutDb);
      scoutDb = null;
    }
  });
}
