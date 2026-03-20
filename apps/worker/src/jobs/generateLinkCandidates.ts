/**
 * Phase 8: Generate Link Candidates Job Handler
 *
 * Deterministic candidate generation for link discovery
 * - Compares entry against recent entries in same pot
 * - Uses entity overlap, tag overlap, keyword similarity
 * - Generates up to N candidates per entry (default 30)
 * - Throttled and bounded for idle-time processing
 */

import type { JobContext } from '@links/storage';
import {
  getEntryById,
  listEntries,
  listArtifactsForEntry,
  insertLinkCandidatesBatch,
  logAuditEvent,
  enqueueJob,
} from '@links/storage';
import type { EntitiesArtifact, TagsArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import {
  calculateCandidateScore,
  CANDIDATE_THRESHOLDS,
  CANDIDATE_LIMITS,
  type CandidateScore,
} from './utils/candidateScoring.js';

const logger = createLogger({ name: 'job:generate-link-candidates' });

/**
 * Job payload for generate_link_candidates
 */
interface GenerateLinkCandidatesPayload {
  maxCandidates?: number; // Optional override
}

/**
 * Candidate with computed score
 */
interface ScoredCandidate {
  dst_entry_id: string;
  score: number;
  reason: string;
}

/**
 * Generate link candidates job handler
 *
 * Triggered when:
 * - New text entry is created
 * - Phase 7 artifacts are generated for an entry
 * - Manual trigger via API
 */
export async function generateLinkCandidatesHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  }, 'Starting candidate generation');

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('generate_link_candidates job requires entry_id');
  }

  // 2. Get source entry (must have text content)
  const srcEntry = await getEntryById(ctx.entryId);
  if (!srcEntry) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
    }, 'Entry not found');
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  // Check for text content (works for type='text', 'doc', etc.)
  if (!srcEntry.content_text || srcEntry.content_text.trim().length === 0) {
    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      type: srcEntry.type,
    }, 'Skipping entry without text content');
    return;
  }

  // 3. Load source entry artifacts (Phase 7)
  const srcArtifacts = await listArtifactsForEntry(ctx.entryId);
  const srcEntities = srcArtifacts.find((a) => a.artifact_type === 'entities');
  const srcTags = srcArtifacts.find((a) => a.artifact_type === 'tags');

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    has_entities: !!srcEntities,
    has_tags: !!srcTags,
  }, 'Loaded source artifacts');

  // 4. Fetch comparison pool (recent entries in same pot, excluding self)
  const poolSize = CANDIDATE_LIMITS.MAX_COMPARISON_POOL_SIZE;
  const comparisonEntries = await listEntries({
    pot_id: srcEntry.pot_id,
    limit: poolSize + 1, // +1 to account for self-exclusion
  });

  // Exclude self
  const comparisonPool = comparisonEntries.filter((e) => e.id !== ctx.entryId);

  logger.info({
    job_id: ctx.jobId,
    pool_size: comparisonPool.length,
  }, 'Fetched comparison pool');

  if (comparisonPool.length === 0) {
    logger.info({
      job_id: ctx.jobId,
    }, 'No other entries to compare against');
    return;
  }

  // 5. Score each candidate in the pool
  const scoredCandidates: ScoredCandidate[] = [];

  for (const dstEntry of comparisonPool) {
    // Skip entries without text content
    if (!dstEntry.content_text || dstEntry.content_text.trim().length === 0) {
      continue;
    }

    // Load destination artifacts
    const dstArtifacts = await listArtifactsForEntry(dstEntry.id);
    const dstEntities = dstArtifacts.find((a) => a.artifact_type === 'entities');
    const dstTags = dstArtifacts.find((a) => a.artifact_type === 'tags');

    // Calculate score
    const scoreResult: CandidateScore = calculateCandidateScore(
      srcEntities?.payload as EntitiesArtifact | null ?? null,
      dstEntities?.payload as EntitiesArtifact | null ?? null,
      srcTags?.payload as TagsArtifact | null ?? null,
      dstTags?.payload as TagsArtifact | null ?? null,
      srcEntry.content_text,
      dstEntry.content_text
    );

    // Filter by minimum score threshold
    if (scoreResult.total >= CANDIDATE_THRESHOLDS.MIN_SCORE) {
      scoredCandidates.push({
        dst_entry_id: dstEntry.id,
        score: scoreResult.total,
        reason: scoreResult.reason,
      });
    }
  }

  logger.info({
    job_id: ctx.jobId,
    candidates_scored: comparisonPool.length,
    candidates_passed_threshold: scoredCandidates.length,
  }, 'Scored candidates');

  // 6. Sort by score (highest first) and take top N
  const maxCandidates = CANDIDATE_LIMITS.MAX_CANDIDATES_PER_ENTRY;
  scoredCandidates.sort((a, b) => b.score - a.score);
  const topCandidates = scoredCandidates.slice(0, maxCandidates);

  if (topCandidates.length === 0) {
    logger.info({
      job_id: ctx.jobId,
    }, 'No candidates passed threshold');
    return;
  }

  // 7. Insert candidates into database (with deduplication)
  const candidateInputs = topCandidates.map((candidate) => ({
    pot_id: srcEntry.pot_id,
    src_entry_id: ctx.entryId as string, // Already validated above
    dst_entry_id: candidate.dst_entry_id,
    reason: candidate.reason,
    score: candidate.score,
  }));

  const insertedCount = await insertLinkCandidatesBatch(candidateInputs);

  logger.info({
    job_id: ctx.jobId,
    candidates_generated: topCandidates.length,
    candidates_inserted: insertedCount,
    candidates_skipped: topCandidates.length - insertedCount,
  }, 'Inserted link candidates');

  // 8. Chain to AI classification if new candidates were inserted
  if (insertedCount > 0) {
    await enqueueJob({
      job_type: 'classify_link_candidate',
      pot_id: srcEntry.pot_id,
      priority: 30,
    });

    logger.info({
      job_id: ctx.jobId,
      pot_id: srcEntry.pot_id,
      candidates_to_classify: insertedCount,
    }, 'Enqueued classify_link_candidate job');
  }

  // 9. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'link_candidates_generated',
    pot_id: srcEntry.pot_id,
    entry_id: ctx.entryId,
    metadata: {
      job_id: ctx.jobId,
      candidates_generated: topCandidates.length,
      candidates_inserted: insertedCount,
      pool_size: comparisonPool.length,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  }, 'Candidate generation complete');
}
