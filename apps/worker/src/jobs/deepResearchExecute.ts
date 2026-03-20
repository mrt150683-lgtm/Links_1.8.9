/**
 * Deep Research Execute Job Handler
 *
 * Main recursive research loop. Handles:
 * - Fresh run start
 * - Resume from checkpoint (after pause or crash)
 * - Budget hard stop → saves partial report, transitions to 'paused'
 *
 * On completion, chains to deep_research_delta.
 */

import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  logAuditEvent,
  getResearchRun,
  updateResearchRunStatus,
  createResearchArtifact,
  setResearchRunArtifacts,
} from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';
import {
  resolveResearchModel,
  PotCorpusProvider,
  WebAugmentProvider,
  executeDeepResearch,
  BudgetExceededError,
} from '@links/deep-research';
import { createLogger } from '@links/logging';
import { updateResearchRunProgress } from '@links/storage';

const logger = createLogger({ name: 'job:deep-research-execute' });

export async function deepResearchExecuteHandler(ctx: JobContext): Promise<void> {
  const runId = ctx.payload?.run_id as string | undefined;
  const resume = (ctx.payload?.resume as boolean | undefined) ?? false;

  if (!runId) throw new Error('deep_research_execute job requires run_id in payload');

  const run = await getResearchRun(runId);
  if (!run) throw new Error(`Research run not found: ${runId}`);

  if (run.status !== 'queued' && run.status !== 'paused' && run.status !== 'running') {
    logger.warn({ run_id: runId, status: run.status, msg: 'Run is not in executable state, skipping' });
    return;
  }

  // Transition to running
  await updateResearchRunStatus(runId, 'running', { started_at: Date.now() });

  logger.info({ run_id: runId, pot_id: run.pot_id, resume, msg: 'Executing deep research' });

  const config = ResearchRunConfigSchema.parse(run.config);

  // Resolve model
  const model = await resolveResearchModel(
    { selected_model: run.selected_model, model_overrides: run.model_overrides as Record<string, string> | null },
    'execute'
  );

  // Build providers
  const corpus = new PotCorpusProvider(run.pot_id);
  const ingestor = config.web_augmentation_enabled
    ? new WebAugmentProvider(run.pot_id, {
        allowlist: config.web_allowlist,
        denylist: config.web_denylist,
      })
    : undefined;

  const researchCtx = {
    runId,
    potId: run.pot_id,
    goalPrompt: run.goal_prompt,
    config,
    corpus,
    ingestor,
    progress: {
      update: async (progress: Record<string, unknown>, budgetUsage?: Record<string, unknown>) => {
        await updateResearchRunProgress(runId, progress, budgetUsage);
      },
    },
  };

  try {
    const result = await executeDeepResearch(researchCtx, {
      model,
      resume: resume
        ? { checkpoint: run.checkpoint, checkpointArtifactId: run.checkpoint_artifact_id }
        : undefined,
    });

    // Store report artifact
    const reportArtifact = await createResearchArtifact({
      run_id: runId,
      artifact_type: 'research_report',
      schema_version: 1,
      model_id: model,
      prompt_id: 'deep_research_report',
      prompt_version: '1',
      temperature: 0.3,
      payload: result.report,
    });

    // Update run with output refs + provenance
    await setResearchRunArtifacts(runId, {
      report_artifact_id: reportArtifact.id,
      model_id: model,
      prompt_ids: ['deep_research_queries', 'deep_research_learnings', 'deep_research_report'],
      entries_read: result.entriesRead,
      sources_ingested: result.sourcesIngested,
    });

    const finalStatus = result.budgetHit ? 'paused' : 'done';
    await updateResearchRunStatus(runId, finalStatus, { finished_at: Date.now() });

    await logAuditEvent({
      actor: 'system',
      action: 'research_run_completed',
      pot_id: run.pot_id,
      metadata: {
        run_id: runId,
        report_artifact_id: reportArtifact.id,
        status: finalStatus,
        budget_hit: result.budgetHit,
        entries_read: result.entriesRead.length,
        learnings_count: result.report.learnings.length,
        insufficiency_reason: result.insufficiencyReason,
      },
    });

    logger.info({
      run_id: runId,
      status: finalStatus,
      entries_read: result.entriesRead.length,
      learnings_count: result.report.learnings.length,
      msg: 'Research execution completed',
    });

    // Chain to delta (only if run fully done and there's a previous run)
    if (!result.budgetHit && run.previous_run_id) {
      await enqueueJob({
        job_type: 'deep_research_delta',
        pot_id: run.pot_id,
        priority: 60,
        payload: { run_id: runId },
      });
    } else if (!result.budgetHit) {
      // No previous run — skip to novelty
      await enqueueJob({
        job_type: 'deep_research_novelty',
        pot_id: run.pot_id,
        priority: 55,
        payload: { run_id: runId },
      });
    }
  } catch (err) {
    // On unexpected error, mark as failed
    await updateResearchRunStatus(runId, 'failed', { finished_at: Date.now() });

    await logAuditEvent({
      actor: 'system',
      action: 'research_run_failed',
      pot_id: run.pot_id,
      metadata: { run_id: runId, error: err instanceof Error ? err.message : String(err) },
    });

    throw err;
  }
}
