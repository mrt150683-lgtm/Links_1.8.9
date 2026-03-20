/**
 * Deep Research Novelty Job Handler
 *
 * Scores novelty of current run's findings. Creates a notification if
 * thresholds are exceeded (max 1 per run per type).
 * Chains to deep_research_links.
 */

import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  logAuditEvent,
  getResearchRun,
  createResearchArtifact,
  setResearchRunArtifacts,
  getResearchArtifact,
  createResearchNotification,
  notificationExistsForRun,
  listEntries,
  createMainChatNotification,
  getPreference,
  setPreference,
  getPotById,
} from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';
import type { ResearchReportArtifact } from '@links/core';
import { resolveResearchModel, computeNovelty, BudgetGuard } from '@links/deep-research';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:deep-research-novelty' });

export async function deepResearchNoveltyHandler(ctx: JobContext): Promise<void> {
  const runId = ctx.payload?.run_id as string | undefined;
  if (!runId) throw new Error('deep_research_novelty job requires run_id in payload');

  const run = await getResearchRun(runId);
  if (!run) throw new Error(`Research run not found: ${runId}`);

  logger.info({ run_id: runId, msg: 'Computing novelty score' });

  // Load current learnings
  const reportArtifact = await getResearchArtifact(runId, 'research_report');
  if (!reportArtifact) {
    logger.warn({ run_id: runId, msg: 'No report artifact found, skipping novelty' });
    await chainToLinks(runId, run.pot_id);
    return;
  }

  const currentReport = reportArtifact.payload as ResearchReportArtifact;
  const currentLearnings = currentReport.learnings;

  // Load prior learnings from previous run (if any)
  const priorLearnings =
    run.previous_run_id
      ? await loadPriorLearnings(run.previous_run_id)
      : [];

  // Load pot summaries for context
  const potSummaries = await loadPotSummaries(run.pot_id);

  const config = ResearchRunConfigSchema.parse(run.config);
  const model = await resolveResearchModel(
    { selected_model: run.selected_model, model_overrides: run.model_overrides as Record<string, string> | null },
    'novelty'
  );

  const budget = new BudgetGuard(config.budget);

  // Compute novelty
  const novelty = await computeNovelty(
    currentLearnings,
    priorLearnings,
    potSummaries,
    config,
    model,
    budget
  );

  // Store novelty artifact
  const noveltyArtifact = await createResearchArtifact({
    run_id: runId,
    artifact_type: 'research_novelty',
    schema_version: 1,
    model_id: model,
    prompt_id: 'deep_research_novelty',
    prompt_version: '1',
    temperature: 0.2,
    payload: novelty,
  });

  await setResearchRunArtifacts(runId, { novelty_artifact_id: noveltyArtifact.id });

  // Create notifications if alert triggered (max 1 per run per type)
  if (novelty.alert_triggered) {
    if (novelty.novelty_score >= config.novelty_threshold) {
      const exists = await notificationExistsForRun(runId, 'novelty_threshold');
      if (!exists) {
        await createResearchNotification({
          pot_id: run.pot_id,
          run_id: runId,
          type: 'novelty_threshold',
          message: `Research run found highly novel findings (score: ${novelty.novelty_score.toFixed(2)})`,
          metadata: { novelty_score: novelty.novelty_score, reasons: novelty.alert_reasons },
        });
      }
    }

    if (novelty.contradictions.some((c: { confidence: number }) => c.confidence >= config.contradiction_threshold)) {
      const exists = await notificationExistsForRun(runId, 'contradiction_threshold');
      if (!exists) {
        await createResearchNotification({
          pot_id: run.pot_id,
          run_id: runId,
          type: 'contradiction_threshold',
          message: `Research run detected contradictions above threshold`,
          metadata: { contradictions: novelty.contradictions.length, reasons: novelty.alert_reasons },
        });
      }
    }

    if (novelty.keyword_matches.length > 0) {
      const exists = await notificationExistsForRun(runId, 'keyword_match');
      if (!exists) {
        await createResearchNotification({
          pot_id: run.pot_id,
          run_id: runId,
          type: 'keyword_match',
          message: `Research found matches for watched keywords: ${novelty.keyword_matches.join(', ')}`,
          metadata: { keyword_matches: novelty.keyword_matches },
        });
      }
    }

    // Slice 7: bridge high-novelty findings to the MainChat notification inbox
    if (novelty.novelty_score >= config.novelty_threshold) {
      const cooldownKey = `nudges.cooldown.insight.research.${run.pot_id}`;
      const lastInsight = await getPreference<number>(cooldownKey);
      const cooldownMs = 6 * 60 * 60 * 1000; // 6 hours

      if (!lastInsight || Date.now() - lastInsight >= cooldownMs) {
        const pot = await getPotById(run.pot_id).catch(() => null);
        const potLabel = (pot as { name?: string } | null)?.name ?? `research run`;
        const topReason = (novelty.alert_reasons as string[] | undefined)?.[0]
          ?? 'New findings detected';

        await createMainChatNotification({
          type: 'insight',
          title: `New research insight: ${potLabel}`,
          preview: `${topReason} (novelty ${novelty.novelty_score.toFixed(2)})`,
          payload: {
            source: 'deep_research',
            run_id: runId,
            pot_id: run.pot_id,
            novelty_score: novelty.novelty_score,
          },
        });

        await setPreference(cooldownKey, Date.now());

        logger.info({
          run_id: runId,
          pot_id: run.pot_id,
          novelty_score: novelty.novelty_score,
          msg: 'MainChat insight notification created (Slice 7)',
        });
      }
    }
  }

  await logAuditEvent({
    actor: 'system',
    action: 'research_novelty_scored',
    pot_id: run.pot_id,
    metadata: {
      run_id: runId,
      novelty_artifact_id: noveltyArtifact.id,
      novelty_score: novelty.novelty_score,
      alert_triggered: novelty.alert_triggered,
    },
  });

  logger.info({
    run_id: runId,
    novelty_score: novelty.novelty_score,
    alert: novelty.alert_triggered,
    msg: 'Novelty scored',
  });

  await chainToLinks(runId, run.pot_id);
}

async function loadPriorLearnings(prevRunId: string) {
  const artifact = await getResearchArtifact(prevRunId, 'research_report');
  if (!artifact) return [];
  return (artifact.payload as ResearchReportArtifact).learnings;
}

async function loadPotSummaries(potId: string): Promise<string[]> {
  // Load summary artifacts for the pot's entries
  const { getDatabase } = await import('@links/storage');
  const db = getDatabase();

  const rows = await db
    .selectFrom('derived_artifacts')
    .select(['payload_json'])
    .where('pot_id', '=', potId)
    .where('artifact_type', '=', 'summary')
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  const summaries: string[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json as string);
      if (payload.summary) summaries.push(payload.summary);
    } catch { /* skip */ }
  }

  return summaries;
}

async function chainToLinks(runId: string, potId: string): Promise<void> {
  await enqueueJob({
    job_type: 'deep_research_links',
    pot_id: potId,
    priority: 50,
    payload: { run_id: runId, max_candidates: 50 },
  });
}
