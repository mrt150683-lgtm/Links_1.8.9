import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { requestIdPlugin } from '@links/logging';
import { toPublicError } from '@links/core';
import type { Config } from '@links/config';
import { initDatabase, runMigrations, getDatabase } from '@links/storage';
import { validateLicense } from '@links/licensing';
import healthRoute from './routes/health.js';
import potsRoute from './routes/pots.js';
import entriesRoute from './routes/entries.js';
import captureRoute from './routes/capture.js';
import prefsRoute from './routes/prefs.js';
import assetsRoute from './routes/assets.js';
import jobsRoute from './routes/jobs.js'; // Phase 5
import { modelsRoutes } from './routes/models.js'; // Phase 6
import { aiPrefsRoutes } from './routes/ai-prefs.js'; // Phase 6
import { aiTestRoutes } from './routes/ai-test.js'; // Phase 6
import { idlePrefsRoutes } from './routes/idle-prefs.js'; // Phase 5 - Idle Processing
import { artifactsRoutes } from './routes/artifacts.js'; // Phase 7
import { linksRoutes } from './routes/links.js'; // Phase 8
import { bundleRoutes } from './routes/bundles.js'; // Phase 9
import extAuthRoutes from './routes/ext/auth.js'; // Phase 11
import extCaptureRoutes from './routes/ext/capture.js'; // Phase 11
import searchRoute from './routes/search.js'; // Phase 12
import diagnosticsRoute from './routes/diagnostics.js'; // Phase 12
import { intelligenceRoutes } from './routes/intelligence.js'; // intel-gen
import { journalRoutes } from './routes/journal.js'; // journal module
import { processingPrefsRoutes } from './routes/processing-prefs.js'; // journal module
import { planningRoutes } from './routes/planning.js'; // planning module
import { researchRoutes } from './routes/research.js'; // deep research agent
import { researchSchedulesRoutes } from './routes/research-schedules.js'; // deep research agent
import { researchNotificationsRoutes } from './routes/research-notifications.js'; // deep research agent
import { chatRoutes } from './routes/chat.js'; // pot chat
import { mainChatRoutes } from './routes/main-chat.js'; // global main chat
import { mainChatNotificationsRoutes } from './routes/main-chat-notifications.js'; // main chat notifications
import { scoutRoutes } from './routes/scout.js'; // scout & repoforge
import { scoutPrefsRoutes } from './routes/scout-prefs.js'; // scout preferences
import { openrouterKeyRoutes, initOpenRouterKeyFromPrefs } from './routes/openrouter-key.js'; // API key UI management
import { browserRoutes } from './routes/browser.js'; // browser persistence
import { calendarRoutes } from './routes/calendar.js'; // calendar
import { dykRoutes } from './routes/dyk.js'; // dyk insights
import { onboardingRoutes } from './routes/onboarding.js'; // pot onboarding
import { searchTargetsRoutes } from './routes/searchTargets.js'; // search targets
import { momRunsRoutes } from './routes/momRuns.js'; // mom chat orchestration
import { voiceRoutes } from './routes/voice.js'; // voice addon
import { translateRoutes } from './routes/translate.js'; // entry translation
import { nutritionRoutes } from './routes/nutrition.js'; // nutrition module
import { rssRoutes } from './routes/rss.js'; // rss module
import { agentRoutes } from './routes/agent.js'; // autonomous agent
import { automationRoutes } from './routes/automation.js'; // automation & heartbeat

/**
 * Validate encryption key safety on startup
 * Prevents data loss by refusing to start if:
 * - Assets exist in the database
 * - ENCRYPTION_KEY was not explicitly set (auto-generated)
 */
async function validateEncryptionKeySafety(): Promise<void> {
  // Check if ENCRYPTION_KEY was explicitly set in environment
  const isKeyExplicit = !!process.env.ENCRYPTION_KEY;

  // Count existing assets in database
  const db = getDatabase();
  const result = await db.selectFrom('assets').select(db.fn.count('id').as('count')).executeTakeFirst();
  const assetCount = Number(result?.count ?? 0);

  if (assetCount > 0 && !isKeyExplicit) {
    console.error('\n=== ENCRYPTION KEY SAFETY CHECK FAILED ===');
    console.error(`Found ${assetCount} encrypted assets in database`);
    console.error('ENCRYPTION_KEY was not explicitly set in .env file');
    console.error('');
    console.error('Starting with an auto-generated key would make existing assets UNREADABLE.');
    console.error('This is a data protection measure to prevent accidental data loss.');
    console.error('');
    console.error('To fix:');
    console.error('1. Set ENCRYPTION_KEY in .env file (must be 64 hex characters)');
    console.error('2. Use the same key that was used to encrypt existing assets');
    console.error('3. Or delete existing assets if starting fresh');
    console.error('==========================================\n');
    throw new Error('Cannot start: ENCRYPTION_KEY required when assets exist');
  }

  if (assetCount > 0 && isKeyExplicit) {
    console.log(`[security] Validated ENCRYPTION_KEY for ${assetCount} existing assets`);
  }
}

export async function createServer(config: Config): Promise<FastifyInstance> {
  // Initialize database
  initDatabase({ filename: config.DATABASE_PATH });
  runMigrations();

  // Validate encryption key safety to prevent data loss
  await validateEncryptionKeySafety();

  // Override OPENROUTER_API_KEY with any key stored by the user through the Settings UI
  await initOpenRouterKeyFromPrefs();

  // Validate license on boot (enforcement point 2)
  // Skip if launched by the launcher (which already validated)
  if (!process.env.LINKS_LICENSE_VALIDATED) {
    const licResult = await validateLicense();
    if (!licResult.valid) {
      throw new Error(
        `License validation failed: ${licResult.reason}. Install a valid license at %APPDATA%\\Links\\license.lic`
    );
    }
  }

  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      name: 'api',
    },
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  });

  // Register plugins
  await fastify.register(requestIdPlugin);
  await fastify.register(multipart); // Phase 4: multipart file uploads

  // Register routes
  await fastify.register(healthRoute);
  await fastify.register(potsRoute);
  await fastify.register(entriesRoute);
  await fastify.register(captureRoute);
  await fastify.register(prefsRoute);
  await fastify.register(assetsRoute); // Phase 4
  await fastify.register(jobsRoute); // Phase 5
  await fastify.register(modelsRoutes); // Phase 6
  await fastify.register(aiPrefsRoutes); // Phase 6
  await fastify.register(aiTestRoutes); // Phase 6
  await fastify.register(idlePrefsRoutes); // Phase 5 - Idle Processing
  await fastify.register(artifactsRoutes); // Phase 7
  await fastify.register(linksRoutes); // Phase 8
  await fastify.register(bundleRoutes); // Phase 9
  await fastify.register(extAuthRoutes, { prefix: '/ext' }); // Phase 11
  await fastify.register(extCaptureRoutes, { prefix: '/ext' }); // Phase 11
  await fastify.register(searchRoute); // Phase 12
  await fastify.register(diagnosticsRoute); // Phase 12
  await fastify.register(intelligenceRoutes); // intel-gen
  await fastify.register(journalRoutes); // journal module
  await fastify.register(processingPrefsRoutes); // journal module
  await fastify.register(planningRoutes); // planning module
  await fastify.register(researchRoutes); // deep research agent
  await fastify.register(researchSchedulesRoutes); // deep research agent
  await fastify.register(researchNotificationsRoutes); // deep research agent
  await fastify.register(chatRoutes); // pot chat
  await fastify.register(mainChatRoutes); // global main chat
  await fastify.register(mainChatNotificationsRoutes); // main chat notifications
  await fastify.register(scoutRoutes); // scout & repoforge
  await fastify.register(scoutPrefsRoutes); // scout preferences
  await fastify.register(openrouterKeyRoutes); // API key UI management
  await fastify.register(browserRoutes); // browser persistence
  await fastify.register(calendarRoutes); // calendar
  await fastify.register(dykRoutes); // dyk insights
  await fastify.register(onboardingRoutes); // pot onboarding
  await fastify.register(searchTargetsRoutes); // search targets
  await fastify.register(momRunsRoutes); // mom chat orchestration
  await fastify.register(voiceRoutes); // voice addon
  await fastify.register(translateRoutes); // entry translation
  await fastify.register(nutritionRoutes); // nutrition module
  await fastify.register(rssRoutes); // rss module
  await fastify.register(agentRoutes); // autonomous agent
  await fastify.register(automationRoutes); // automation & heartbeat (044-046)

  // Root route
  fastify.get('/', async () => {
    return {
      service: 'links-api',
      version: '0.1.0',
      status: 'running',
    };
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const errorResponse = {
        error: 'ValidationError',
        message: 'Invalid request data',
        statusCode: 400,
        request_id: request.id,
        details: error.errors,
      };

      request.log.warn({ err: error, request_id: request.id }, 'Validation error');

      reply.status(400).send(errorResponse);
      return;
    }

    // Handle other errors
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    const errorResponse = toPublicError({ ...err, statusCode });

    // Add request_id to error response
    errorResponse.request_id = request.id;

    request.log.error({ err, request_id: request.id }, 'Request error');

    reply.status(statusCode).send(errorResponse);
  });

  return fastify;
}
