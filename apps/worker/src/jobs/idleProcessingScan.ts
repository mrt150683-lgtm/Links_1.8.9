/**
 * idle_processing_scan Job Handler
 *
 * Self-re-enqueuing scanner that runs every 15 minutes.
 * On each tick:
 *   1. Read idle processing preferences (bail if disabled)
 *   2. List all pots (filtered by pot_ids if configured)
 *   3. For each pot, scan entries for missing artifacts and enqueue AI jobs
 *   4. Re-enqueue itself with run_after = now + 15 min
 *
 * Bootstrapped once on worker startup.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getIdlePrefs,
  listPots,
  listEntries,
  getLatestArtifact,
  enqueueJob,
  hasQueuedJobOfType,
  hasActiveJobForEntry,
} from '@links/storage';

const logger = createLogger({ name: 'job:idle-processing-scan' });

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ENTRIES_PER_POT = 200;

export async function idleProcessingScanHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Idle processing scan tick' });

  const idlePrefs = await getIdlePrefs();

  if (!idlePrefs.enabled) {
    logger.info({ job_id: ctx.jobId, msg: 'Idle processing disabled, skipping scan' });
    await selfReEnqueue();
    return;
  }

  const allPots = await listPots(100);

  const targetPots =
    idlePrefs.pot_ids && idlePrefs.pot_ids.length > 0
      ? allPots.filter((p) => idlePrefs.pot_ids!.includes(p.id))
      : allPots;

  let totalEnqueued = 0;
  for (const pot of targetPots) {
    const count = await scanPotForWork(pot.id);
    totalEnqueued += count;
  }

  logger.info({
    job_id: ctx.jobId,
    pots_scanned: targetPots.length,
    total_enqueued: totalEnqueued,
    msg: 'Idle processing scan complete',
  });

  await selfReEnqueue();
}

async function selfReEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('idle_processing_scan'))) {
    await enqueueJob({
      job_type: 'idle_processing_scan',
      run_after: Date.now() + SCAN_INTERVAL_MS,
      priority: 5,
    });
  }
}

async function scanPotForWork(potId: string): Promise<number> {
  const entries = await listEntries({ pot_id: potId, limit: MAX_ENTRIES_PER_POT });
  let enqueued = 0;

  for (const entry of entries) {
    // Skip entries with no content at all
    if (!entry.content_text && !entry.asset_id) continue;

    // STAGE 1: Asset-backed entries (doc/audio) needing text extraction
    if (entry.asset_id && !entry.content_text) {
      const artifact = await getLatestArtifact(entry.id, 'extracted_text');
      if (!artifact && !(await hasActiveJobForEntry('extract_text', entry.id))) {
        await enqueueJob({ job_type: 'extract_text', entry_id: entry.id, pot_id: potId, priority: 10 });
        enqueued++;
      }
      // Don't proceed to further stages until text is extracted
      continue;
    }

    const hasText = !!entry.content_text;
    const isImage = entry.type === 'image';

    // STAGE 2: Tagging (text entries and images)
    if (hasText || isImage) {
      const tagsArtifact = await getLatestArtifact(entry.id, 'tags');
      if (!tagsArtifact && !(await hasActiveJobForEntry('tag_entry', entry.id))) {
        await enqueueJob({ job_type: 'tag_entry', entry_id: entry.id, pot_id: potId, priority: 10 });
        enqueued++;
      }
    }

    // STAGE 3: Summarization (text only, not images)
    if (hasText && !isImage) {
      const summaryArtifact = await getLatestArtifact(entry.id, 'summary');
      if (!summaryArtifact && !(await hasActiveJobForEntry('summarize_entry', entry.id))) {
        await enqueueJob({ job_type: 'summarize_entry', entry_id: entry.id, pot_id: potId, priority: 10 });
        enqueued++;
      }
    }

    // STAGE 4: Link candidate generation (text only, requires tags to exist first)
    // generate_link_candidates is idempotent via UNIQUE constraint in insertLinkCandidatesBatch
    if (hasText && !isImage) {
      const tagsArtifact = await getLatestArtifact(entry.id, 'tags');
      if (tagsArtifact && !(await hasActiveJobForEntry('generate_link_candidates', entry.id))) {
        await enqueueJob({ job_type: 'generate_link_candidates', entry_id: entry.id, pot_id: potId, priority: 5 });
        enqueued++;
      }
    }
  }

  return enqueued;
}
