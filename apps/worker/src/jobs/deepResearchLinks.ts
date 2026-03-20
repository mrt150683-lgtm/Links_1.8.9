/**
 * Deep Research Links Job Handler
 *
 * Extracts link candidates from research run learnings and enqueues
 * classify_link_candidate jobs. Enforces max_links_per_run cap.
 * Final job in the deep research chain.
 */

import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  logAuditEvent,
  getResearchRun,
  getResearchArtifact,
  insertLinkCandidate,
} from '@links/storage';
import { ResearchRunConfigSchema } from '@links/core';
import type { ResearchReportArtifact } from '@links/core';
import { extractLinkCandidates } from '@links/deep-research';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:deep-research-links' });

export async function deepResearchLinksHandler(ctx: JobContext): Promise<void> {
  const runId = ctx.payload?.run_id as string | undefined;
  if (!runId) throw new Error('deep_research_links job requires run_id in payload');

  const run = await getResearchRun(runId);
  if (!run) throw new Error(`Research run not found: ${runId}`);

  const config = ResearchRunConfigSchema.parse(run.config);
  const maxLinksPerRun = config.budget.max_links_per_run ?? 50;

  logger.info({ run_id: runId, max_links_per_run: maxLinksPerRun, msg: 'Extracting link candidates from research' });

  // Load report artifact
  const reportArtifact = await getResearchArtifact(runId, 'research_report');
  if (!reportArtifact) {
    logger.warn({ run_id: runId, msg: 'No report artifact found, skipping link extraction' });
    return;
  }

  const report = reportArtifact.payload as ResearchReportArtifact;

  // Extract candidates from learnings (filters by confidence >= 0.6 OR evidence_excerpts for both entries)
  const candidates = extractLinkCandidates(report.learnings, maxLinksPerRun);

  logger.info({ run_id: runId, candidate_count: candidates.length, msg: 'Link candidates extracted' });

  let inserted = 0;
  const enqueuedJobIds: string[] = [];

  for (const candidate of candidates) {
    if (inserted >= maxLinksPerRun) {
      logger.info({ run_id: runId, max_links_per_run: maxLinksPerRun, msg: 'max_links_per_run cap reached, stopping' });
      break;
    }

    // Insert candidate (deduped via UNIQUE constraint)
    const result = await insertLinkCandidate({
      pot_id: run.pot_id,
      src_entry_id: candidate.src_entry_id,
      dst_entry_id: candidate.dst_entry_id,
      reason: candidate.reason,
      score: candidate.confidence,
    });

    if (result) {
      inserted++;

      // Enqueue classify job for each new candidate
      const job = await enqueueJob({
        job_type: 'classify_link_candidate',
        pot_id: run.pot_id,
        priority: 40,
        payload: { candidate_id: result.id },
      });

      enqueuedJobIds.push(job.id);
    }
  }

  await logAuditEvent({
    actor: 'system',
    action: 'research_links_extracted',
    pot_id: run.pot_id,
    metadata: {
      run_id: runId,
      candidates_found: candidates.length,
      candidates_inserted: inserted,
      classify_jobs_enqueued: enqueuedJobIds.length,
    },
  });

  logger.info({
    run_id: runId,
    inserted,
    enqueued: enqueuedJobIds.length,
    msg: 'Deep research links extraction complete',
  });
}
