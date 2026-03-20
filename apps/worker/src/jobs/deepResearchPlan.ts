/**
 * Deep Research Plan Job Handler
 *
 * Generates a research plan artifact for a run and transitions it to
 * 'awaiting_approval'. If auto_approve_plan is set in config, immediately
 * approves and enqueues deep_research_execute.
 */

import type { JobContext } from '@links/storage';
import {
  getAIPreferences,
  enqueueJob,
  logAuditEvent,
  getResearchRun,
  setResearchRunPlan,
  updateResearchRunStatus,
  createResearchArtifact,
  approveResearchRunPlan,
} from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';
import { generateResearchPlan, resolveResearchModel, PotCorpusProvider } from '@links/deep-research';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:deep-research-plan' });

export async function deepResearchPlanHandler(ctx: JobContext): Promise<void> {
  const runId = ctx.payload?.run_id as string | undefined;
  if (!runId) throw new Error('deep_research_plan job requires run_id in payload');

  const run = await getResearchRun(runId);
  if (!run) throw new Error(`Research run not found: ${runId}`);

  if (run.status !== 'draft' && run.status !== 'planning') {
    logger.warn({ run_id: runId, status: run.status, msg: 'Run is not in plannable state, skipping' });
    return;
  }

  // Transition to planning
  await updateResearchRunStatus(runId, 'planning');

  logger.info({ run_id: runId, pot_id: run.pot_id, msg: 'Generating research plan' });

  // Parse run config
  const config = ResearchRunConfigSchema.parse(run.config);

  // Resolve model
  const model = await resolveResearchModel(
    { selected_model: run.selected_model, model_overrides: run.model_overrides as Record<string, string> | null },
    'plan'
  );

  // Build context
  const corpus = new PotCorpusProvider(run.pot_id);
  const researchCtx = {
    runId,
    potId: run.pot_id,
    goalPrompt: run.goal_prompt,
    config,
    corpus,
  };

  // Generate plan
  const plan = await generateResearchPlan(researchCtx, model);

  // Store plan artifact
  const artifact = await createResearchArtifact({
    run_id: runId,
    artifact_type: 'research_plan',
    schema_version: 1,
    model_id: model,
    prompt_id: 'deep_research_plan',
    prompt_version: '1',
    temperature: 0.2,
    payload: plan,
  });

  // Link plan artifact to run
  await setResearchRunPlan(runId, artifact.id);

  await logAuditEvent({
    actor: 'system',
    action: 'research_plan_generated',
    pot_id: run.pot_id,
    metadata: { run_id: runId, artifact_id: artifact.id, model_id: model },
  });

  logger.info({ run_id: runId, artifact_id: artifact.id, msg: 'Research plan generated' });

  // Check auto_approve_plan flag
  const autoApprove = (run.config as any)?.auto_approve_plan === true;

  if (autoApprove) {
    logger.info({ run_id: runId, msg: 'Auto-approving research plan' });
    await approveResearchRunPlan(runId);

    await enqueueJob({
      job_type: 'deep_research_execute',
      pot_id: run.pot_id,
      priority: 70,
      payload: { run_id: runId, resume: false },
    });

    logger.info({ run_id: runId, msg: 'Enqueued deep_research_execute (auto-approved)' });
  }
}
