#!/usr/bin/env node
/**
 * Worker CLI entry point
 * Phase 5: Processing Engine
 */

import process from 'node:process';
import { getConfig } from '@links/config';
import { createLogger } from '@links/logging';
import { initDatabase, runMigrations, registerJobType, enqueueJob, hasQueuedJobOfType } from '@links/storage';
import { validateLicense } from '@links/licensing';
import { runWorkerOnce, runWorkerDaemon, getDefaultWorkerConfig } from './worker.js';
import { refreshModelsHandler } from './jobs/refreshModels.js';
import { extractTextHandler } from './jobs/extractText.js';
import { tagEntryHandler } from './jobs/tagEntry.js';
import { extractEntitiesHandler } from './jobs/extractEntities.js';
import { summarizeEntryHandler } from './jobs/summarizeEntry.js';
import { generateLinkCandidatesHandler } from './jobs/generateLinkCandidates.js';
import { classifyLinkCandidateHandler } from './jobs/classifyLinkCandidate.js';
import { transcribeVideoHandler } from './jobs/transcribeVideo.js';
import { parseYoutubeHtmlHandler } from './jobs/parseYoutubeHtml.js';
import { intelGenerateQuestionsHandler } from './jobs/intelGenerateQuestions.js';
import { intelAnswerQuestionHandler } from './jobs/intelAnswerQuestion.js';
import { buildDailyJournalNoteHandler } from './jobs/buildDailyJournalNote.js';
import { buildRollupJournalNoteHandler } from './jobs/buildRollupJournalNote.js';
import { scheduleJournalBackfillIfEnabled } from './journalScheduler.js';
import { journalCronSchedulerHandler } from './jobs/journalCronScheduler.js';
import {
  planningGenerateQuestionsHandler,
  planningGeneratePlanHandler,
  planningGeneratePhaseHandler,
  planningGenerateDocHandler,
} from './jobs/planningHandlers.js';
import { planningExportZipHandler } from './jobs/planningExportZip.js';
import { dictionizeUserStyleHandler } from './jobs/dictionize.js';
import { generateNudgesHandler } from './jobs/generateNudges.js'; // Slice 4
import { extractDatesHandler } from './jobs/extractDates.js';
import { calendarSyncHandler } from './jobs/calendarSync.js';
import { calendarEmitDailyNotificationHandler } from './jobs/calendarEmitDailyNotification.js';
import { calendarSchedulerHandler } from './jobs/calendarScheduler.js';
import { idleProcessingScanHandler } from './jobs/idleProcessingScan.js';
import { momPlanHandler } from './jobs/momPlan.js';
import { momRunAgentsHandler } from './jobs/momRunAgents.js';
import { momReviewHandler } from './jobs/momReview.js';
import { momMergeHandler } from './jobs/momMerge.js';
import { nutritionMealAnalysisHandler } from './jobs/nutritionMealAnalysis.js';
import { nutritionSchedulerHandler } from './jobs/nutritionScheduler.js';
import { nutritionDailyReviewHandler } from './jobs/nutritionDailyReview.js';
import { nutritionWeeklyReviewHandler } from './jobs/nutritionWeeklyReview.js';
import { nutritionWeeklyCheckinReminderHandler } from './jobs/nutritionWeeklyCheckinReminder.js';
import { nutritionPatternAnalysisHandler } from './jobs/nutritionPatternAnalysis.js';
import { rssSchedulerHandler } from './jobs/rssScheduler.js';
import { rssCollectorHandler } from './jobs/rssCollector.js';
import { agentSchedulerHandler } from './jobs/agentScheduler.js';
import { agentHeartbeatHandler } from './jobs/agentHeartbeat.js';
import { agentSnapshotCleanupHandler } from './jobs/agentSnapshotCleanup.js';
import { agentToolBuildHandler } from './jobs/agentToolBuild.js';
import { agentToolTestHandler } from './jobs/agentToolTest.js';
import { agentToolRunHandler } from './jobs/agentToolRun.js';
import { agentBridgeSchedulerHandler } from './jobs/agentBridgeScheduler.js';
import { agentSnapshotExecutorHandler } from './jobs/agentSnapshotExecutor.js';
import { automationSchedulerHandler } from './jobs/automationScheduler.js';
import { heartbeatGenerateHandler } from './jobs/heartbeatGenerate.js';
import { heartbeatRenderHandler } from './jobs/heartbeatRender.js';
import { taskExecuteHandler } from './jobs/taskExecute.js';
import { automationDailyReconcileHandler } from './jobs/automationDailyReconcile.js';
import { rssCleanupHandler } from './jobs/rssCleanup.js';
import { weeklyResearchDigestHandler } from './jobs/weeklyResearchDigest.js';
import { proactiveConversationHandler } from './jobs/proactiveConversation.js';
import { proactiveMainChatHandler } from './jobs/proactiveMainChat.js';

const logger = createLogger({ name: 'worker' });

/**
 * Parse CLI arguments
 */
function parseArgs(): {
  mode: 'once' | 'daemon';
  minutes?: number;
} {
  const args = process.argv.slice(2);

  let mode: 'once' | 'daemon' = 'daemon';
  let minutes: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--once') {
      mode = 'once';
    } else if (arg === '--minutes') {
      const nextArg = args[++i];
      if (!nextArg) {
        logger.error({ msg: '--minutes requires a value' });
        process.exit(1);
      }
      minutes = parseInt(nextArg, 10);
      if (isNaN(minutes)) {
        logger.error({ arg: nextArg, msg: 'Invalid --minutes value' });
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      logger.error({ arg, msg: 'Unknown argument' });
      printHelp();
      process.exit(1);
    }
  }

  return { mode, minutes };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Links Worker - Background job processor

Usage:
  pnpm worker [options]

Options:
  --once         Run once (process one job then exit)
  --minutes N    Run for N minutes then exit (daemon mode)
  --help, -h     Show this help message

Environment Variables:
  IDLE_MODE_ENABLED=true/false   Enable idle-time processing controls
  IDLE_ONLY=true/false           Only process when system is idle
  RUN_WINDOW_START=HH:MM         Start time for processing window (24-hour)
  RUN_WINDOW_END=HH:MM           End time for processing window (24-hour)

Examples:
  # Run continuously (daemon mode)
  pnpm worker

  # Process one job then exit (for testing/smoke scripts)
  pnpm worker --once

  # Run for 5 minutes then exit
  pnpm worker --minutes 5

  # Run with idle controls enabled
  IDLE_MODE_ENABLED=true RUN_WINDOW_START=22:00 RUN_WINDOW_END=06:00 pnpm worker
  `);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const config = getConfig();
    const { mode, minutes } = parseArgs();

    // Initialize database
    initDatabase({ filename: config.DATABASE_PATH });
    runMigrations();

    // Validate license on boot (enforcement point 3)
    // Skip if launched by the launcher (which already validated)
    if (!process.env.LINKS_LICENSE_VALIDATED) {
      const licResult = await validateLicense();
      if (!licResult.valid) {
        logger.error({ reason: licResult.reason, msg: 'License validation failed' });
        process.exit(1);
      }
    }

    // Register Phase 5 job handlers
    registerJobType('extract_text', extractTextHandler);

    // Register Phase 6 job handlers
    registerJobType('refresh_models', async (ctx) => {
      await refreshModelsHandler();
    });

    // Register Phase 7 job handlers
    registerJobType('tag_entry', tagEntryHandler);
    registerJobType('extract_entities', extractEntitiesHandler);
    registerJobType('summarize_entry', summarizeEntryHandler);

    // Register Phase 8 job handlers
    registerJobType('generate_link_candidates', generateLinkCandidatesHandler);
    registerJobType('classify_link_candidate', classifyLinkCandidateHandler);

    // Register video transcription handler
    registerJobType('transcribe_video', transcribeVideoHandler);

    // Register YouTube HTML parser handler
    registerJobType('parse_youtube_html', parseYoutubeHtmlHandler);

    // Register intel-gen job handlers
    registerJobType('intel_generate_questions', intelGenerateQuestionsHandler);
    registerJobType('intel_answer_question', intelAnswerQuestionHandler);

    // Register journal job handlers
    registerJobType('build_daily_journal_note', buildDailyJournalNoteHandler);
    registerJobType('build_weekly_journal_summary', buildRollupJournalNoteHandler);
    registerJobType('build_monthly_journal_summary', buildRollupJournalNoteHandler);
    registerJobType('build_quarterly_journal_summary', buildRollupJournalNoteHandler);
    registerJobType('build_yearly_journal_summary', buildRollupJournalNoteHandler);

    // Journal backfill scheduler (enqueues missing notes at startup, skipped in --once mode)
    await scheduleJournalBackfillIfEnabled(mode === 'once');

    // Journal cron scheduler — fires journal generation at 23:50 local time
    registerJobType('journal_cron_scheduler', journalCronSchedulerHandler);
    if (!(await hasQueuedJobOfType('journal_cron_scheduler'))) {
      await enqueueJob({ job_type: 'journal_cron_scheduler', run_after: Date.now() + 15_000, priority: 5 });
    }

    // Register planning job handlers
    registerJobType('planning_generate_questions', planningGenerateQuestionsHandler);
    registerJobType('planning_generate_plan', planningGeneratePlanHandler);
    registerJobType('planning_generate_phase', planningGeneratePhaseHandler);
    registerJobType('planning_generate_doc', planningGenerateDocHandler);
    registerJobType('planning_export_zip', planningExportZipHandler);

    // Register dictionize job handler
    registerJobType('dictionize_user_style', dictionizeUserStyleHandler);

    // Register proactive nudge job handler (Slice 4)
    registerJobType('generate_nudges', generateNudgesHandler);

    // Register calendar job handlers (029_calendar)
    registerJobType('extract_dates', extractDatesHandler);
    registerJobType('calendar_sync', calendarSyncHandler);
    registerJobType('calendar_emit_daily_notification', calendarEmitDailyNotificationHandler);
    registerJobType('calendar_scheduler', calendarSchedulerHandler);

    // Bootstrap calendar scheduler (only if not already queued — prevents accumulation across restarts)
    if (!(await hasQueuedJobOfType('calendar_scheduler'))) {
      await enqueueJob({ job_type: 'calendar_scheduler', run_after: Date.now() + 5_000, priority: 5 });
    }

    // Register idle processing scan handler
    registerJobType('idle_processing_scan', idleProcessingScanHandler);

    // MoM worker-backed jobs (Phase 3)
    registerJobType('mom_plan', momPlanHandler);
    registerJobType('mom_run_agents', momRunAgentsHandler);
    registerJobType('mom_review', momReviewHandler);
    registerJobType('mom_merge', momMergeHandler);

    // Nutrition module (036)
    registerJobType('nutrition_meal_analysis', nutritionMealAnalysisHandler);
    registerJobType('nutrition_scheduler', nutritionSchedulerHandler);
    registerJobType('nutrition_daily_review', nutritionDailyReviewHandler);
    registerJobType('nutrition_weekly_review', nutritionWeeklyReviewHandler);
    registerJobType('nutrition_weekly_checkin_reminder', nutritionWeeklyCheckinReminderHandler);
    registerJobType('nutrition_pattern_analysis', nutritionPatternAnalysisHandler);

    // Bootstrap nutrition scheduler (only if not already queued)
    if (!(await hasQueuedJobOfType('nutrition_scheduler'))) {
      await enqueueJob({ job_type: 'nutrition_scheduler', run_after: Date.now() + 20_000, priority: 5 });
    }

    // RSS module (038)
    registerJobType('rss_scheduler', rssSchedulerHandler);
    registerJobType('rss_collector', rssCollectorHandler);

    // Bootstrap RSS scheduler (only if not already queued)
    if (!(await hasQueuedJobOfType('rss_scheduler'))) {
      await enqueueJob({ job_type: 'rss_scheduler', run_after: Date.now() + 25_000, priority: 5 });
    }

    // Autonomous agent (040-043)
    registerJobType('agent_scheduler', agentSchedulerHandler);
    registerJobType('agent_heartbeat', agentHeartbeatHandler);
    registerJobType('agent_snapshot_cleanup', agentSnapshotCleanupHandler);
    registerJobType('agent_tool_build', agentToolBuildHandler);
    registerJobType('agent_tool_test', agentToolTestHandler);
    registerJobType('agent_tool_run', agentToolRunHandler);
    registerJobType('agent_bridge_scheduler', agentBridgeSchedulerHandler);
    registerJobType('agent_snapshot_executor', agentSnapshotExecutorHandler);

    // Bootstrap agent scheduler (only if not already queued)
    if (!(await hasQueuedJobOfType('agent_scheduler'))) {
      await enqueueJob({ job_type: 'agent_scheduler', run_after: Date.now() + 30_000, priority: 5 });
    }
    // Bootstrap agent snapshot cleanup (self-re-enqueuing 30-min cleanup)
    if (!(await hasQueuedJobOfType('agent_snapshot_cleanup'))) {
      await enqueueJob({ job_type: 'agent_snapshot_cleanup', run_after: Date.now() + 35_000, priority: 3 });
    }

    // Bootstrap idle processing scanner (self-re-enqueues every 15 min)
    // 10s startup delay — slightly after calendar_scheduler's 5s
    if (!(await hasQueuedJobOfType('idle_processing_scan'))) {
      await enqueueJob({ job_type: 'idle_processing_scan', run_after: Date.now() + 10_000, priority: 5 });
    }

    // Automation & Heartbeat (044-046)
    registerJobType('automation_scheduler', automationSchedulerHandler);
    registerJobType('heartbeat_generate', heartbeatGenerateHandler);
    registerJobType('heartbeat_render', heartbeatRenderHandler);
    registerJobType('task_execute', taskExecuteHandler);
    registerJobType('automation_daily_reconcile', automationDailyReconcileHandler);

    // Bootstrap automation scheduler (40s delay — after agent_snapshot_cleanup's 35s)
    if (!(await hasQueuedJobOfType('automation_scheduler'))) {
      await enqueueJob({ job_type: 'automation_scheduler', run_after: Date.now() + 40_000, priority: 5 });
    }
    // Bootstrap automation daily reconcile (45s delay, then re-enqueues at midnight)
    if (!(await hasQueuedJobOfType('automation_daily_reconcile'))) {
      await enqueueJob({ job_type: 'automation_daily_reconcile', run_after: Date.now() + 45_000, priority: 3 });
    }

    // Scheduled task jobs (triggered by journal_cron_scheduler)
    registerJobType('rss_cleanup', rssCleanupHandler);
    registerJobType('weekly_research_digest', weeklyResearchDigestHandler);
    registerJobType('proactive_conversation', proactiveConversationHandler);
    registerJobType('proactive_main_chat', proactiveMainChatHandler);

    const workerConfig = getDefaultWorkerConfig();

    logger.info({
      worker_id: workerConfig.workerId,
      mode,
      database: config.DATABASE_PATH,
      msg: 'Worker starting',
    });

    if (mode === 'once') {
      // Run once mode
      const processed = await runWorkerOnce(config, workerConfig);
      process.exit(processed ? 0 : 1);
    } else {
      // Daemon mode
      const abortController = new AbortController();

      // Graceful shutdown on SIGINT/SIGTERM
      process.on('SIGINT', () => {
        logger.info({ msg: 'Received SIGINT, shutting down gracefully' });
        abortController.abort();
      });

      process.on('SIGTERM', () => {
        logger.info({ msg: 'Received SIGTERM, shutting down gracefully' });
        abortController.abort();
      });

      // Run with optional timeout
      if (minutes) {
        setTimeout(() => {
          logger.info({ minutes, msg: 'Time limit reached, shutting down' });
          abortController.abort();
        }, minutes * 60 * 1000);
      }

      const stats = await runWorkerDaemon(config, workerConfig, abortController.signal);

      logger.info({
        jobs_processed: stats.jobsProcessed,
        jobs_succeeded: stats.jobsSucceeded,
        jobs_failed: stats.jobsFailed,
        uptime_ms: Date.now() - stats.startedAt,
        msg: 'Worker finished',
      });

      process.exit(0);
    }
  } catch (error) {
    // Write error synchronously to stderr and flush before exiting.
    // logger.error() + process.exit() can lose buffered output in piped
    // child processes (Electron utilityProcess), causing silent crashes.
    const msg = `Worker crashed: ${error instanceof Error ? error.stack || error.message : error}\n`;
    process.stderr.write(msg, () => {
      process.exit(1);
    });
    // Fallback: if the write callback never fires, exit after a short delay
    setTimeout(() => process.exit(1), 500);
  }
}

main();
