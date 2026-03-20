/**
 * Deep Research Delta Job Handler
 *
 * Computes the delta (diff) between current run and the previous run.
 * Stores result as a research_delta artifact.
 * Chains to deep_research_novelty.
 */

import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  logAuditEvent,
  getResearchRun,
  createResearchArtifact,
  setResearchRunArtifacts,
  getResearchArtifact,
} from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';
import type { ResearchReportArtifact } from '@links/core';
import { resolveResearchModel, computeDelta, BudgetGuard } from '@links/deep-research';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:deep-research-delta' });

export async function deepResearchDeltaHandler(ctx: JobContext): Promise<void> {
  const runId = ctx.payload?.run_id as string | undefined;
  if (!runId) throw new Error('deep_research_delta job requires run_id in payload');

  const run = await getResearchRun(runId);
  if (!run) throw new Error(`Research run not found: ${runId}`);

  if (!run.previous_run_id) {
    logger.info({ run_id: runId, msg: 'No previous run — skipping delta, proceeding to novelty' });
    await enqueueJob({
      job_type: 'deep_research_novelty',
      pot_id: run.pot_id,
      priority: 55,
      payload: { run_id: runId },
    });
    return;
  }

  logger.info({ run_id: runId, previous_run_id: run.previous_run_id, msg: 'Computing research delta' });

  // Load current report learnings
  if (!run.report_artifact_id) throw new Error(`Run ${runId} has no report artifact`);
  const reportArtifact = await getResearchArtifact(runId, 'research_report');
  if (!reportArtifact) throw new Error(`Report artifact not found for run ${runId}`);

  const currentReport = reportArtifact.payload as ResearchReportArtifact;
  const currentLearnings = currentReport.learnings;

  // Load previous report learnings
  const prevRun = await getResearchRun(run.previous_run_id);
  if (!prevRun?.report_artifact_id) {
    logger.warn({ run_id: runId, previous_run_id: run.previous_run_id, msg: 'Previous run has no report, skipping delta' });
    await enqueueJob({
      job_type: 'deep_research_novelty',
      pot_id: run.pot_id,
      priority: 55,
      payload: { run_id: runId },
    });
    return;
  }

  const prevReportArtifact = await getResearchArtifact(run.previous_run_id, 'research_report');
  const previousLearnings = prevReportArtifact
    ? (prevReportArtifact.payload as ResearchReportArtifact).learnings
    : [];

  // Resolve model
  const config = ResearchRunConfigSchema.parse(run.config);
  const model = await resolveResearchModel(
    { selected_model: run.selected_model, model_overrides: run.model_overrides as Record<string, string> | null },
    'delta'
  );

  const budget = new BudgetGuard(config.budget);

  // Compute delta
  const delta = await computeDelta(
    currentLearnings,
    previousLearnings,
    run.previous_run_id,
    model,
    budget
  );

  // Store delta artifact
  const deltaArtifact = await createResearchArtifact({
    run_id: runId,
    artifact_type: 'research_delta',
    schema_version: 1,
    model_id: model,
    prompt_id: 'deep_research_delta',
    prompt_version: '1',
    temperature: 0.2,
    payload: delta,
  });

  await setResearchRunArtifacts(runId, { delta_artifact_id: deltaArtifact.id });

  await logAuditEvent({
    actor: 'system',
    action: 'research_delta_computed',
    pot_id: run.pot_id,
    metadata: {
      run_id: runId,
      previous_run_id: run.previous_run_id,
      delta_artifact_id: deltaArtifact.id,
      new_findings: delta.new_findings.length,
      changed_findings: delta.changed_findings.length,
    },
  });

  logger.info({ run_id: runId, delta_artifact_id: deltaArtifact.id, msg: 'Delta computed' });

  // Chain to novelty scoring
  await enqueueJob({
    job_type: 'deep_research_novelty',
    pot_id: run.pot_id,
    priority: 55,
    payload: { run_id: runId },
  });
}
