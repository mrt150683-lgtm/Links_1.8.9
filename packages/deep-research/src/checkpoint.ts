/**
 * CheckpointStore
 *
 * Manages the split checkpoint for deep research runs:
 * - Light checkpoint (row): depth_stack, visited IDs, budget_usage (no accumulated_learnings)
 * - Heavy checkpoint (artifact): accumulated_learnings + full entries_read list
 *
 * Written at each depth transition and after each batch of queries.
 * Resume loads light checkpoint from run row, then fetches learnings from artifact.
 */

import { createLogger } from '@links/logging';
import {
  upsertResearchArtifact,
  updateResearchRunCheckpoint,
  getResearchArtifactById,
} from '@links/storage';
import { CheckpointLightSchema, ResearchCheckpointArtifactSchema } from '@links/core';
import type { Learning, CheckpointLight, ResearchCheckpointArtifact, BudgetUsage } from '@links/core';
import type { DepthFrame } from './types.js';

const logger = createLogger({ name: 'deep-research:checkpoint' });

export interface CheckpointSaveInput {
  runId: string;
  potId: string;
  depthStack: DepthFrame[];
  visitedEntryIds: string[];
  visitedUrls: string[];
  budgetUsage: BudgetUsage;
  accumulatedLearnings: Learning[];
  entriesReadFull: Array<{ id: string; sha256: string }>;
  startedAt: number;
  currentPhase: 'constraint' | 'research';
  constraintLearningsCount: number;
  topicKeywords: string[];
}

/**
 * Save checkpoint state (split: light in run row + full learnings in artifact)
 */
export async function saveCheckpoint(input: CheckpointSaveInput): Promise<void> {
  const {
    runId, potId, depthStack, visitedEntryIds, visitedUrls,
    budgetUsage, accumulatedLearnings, entriesReadFull, startedAt,
    currentPhase, constraintLearningsCount, topicKeywords,
  } = input;

  // 1. Write accumulated_learnings to research_checkpoint artifact
  const artifactPayload: ResearchCheckpointArtifact = {
    accumulated_learnings: accumulatedLearnings,
    entries_read_full: entriesReadFull,
    updated_at: Date.now(),
  };

  const artifact = await upsertResearchArtifact({
    run_id: runId,
    artifact_type: 'research_checkpoint',
    schema_version: 1,
    payload: artifactPayload,
  });

  // 2. Write light checkpoint to run row (no accumulated_learnings)
  const checkpointLight: CheckpointLight = {
    depth_stack: depthStack,
    visited_entry_ids: visitedEntryIds,
    visited_urls: visitedUrls,
    budget_usage: budgetUsage,
    checkpoint_artifact_id: artifact.id,
    started_at: startedAt,
    current_phase: currentPhase,
    constraint_learnings_count: constraintLearningsCount,
    topic_keywords: topicKeywords,
  };

  await updateResearchRunCheckpoint(runId, checkpointLight as unknown as Record<string, unknown>, artifact.id);

  logger.info({
    run_id: runId,
    learnings_count: accumulatedLearnings.length,
    entries_read: entriesReadFull.length,
    msg: 'Checkpoint saved',
  });
}

/**
 * Load checkpoint on resume.
 * Returns null if no checkpoint exists or checkpoint is corrupt (caller should restart from scratch).
 */
export async function loadCheckpoint(
  runCheckpoint: Record<string, unknown> | null,
  checkpointArtifactId: string | null
): Promise<{
  depthStack: DepthFrame[];
  visitedEntryIds: Set<string>;
  visitedUrls: Set<string>;
  budgetUsage: BudgetUsage;
  accumulatedLearnings: Learning[];
  entriesReadFull: Array<{ id: string; sha256: string }>;
  startedAt: number;
  currentPhase: 'constraint' | 'research';
  constraintLearningsCount: number;
  topicKeywords: string[];
} | null> {
  if (!runCheckpoint || !checkpointArtifactId) return null;

  try {
    // Parse light checkpoint
    const light = CheckpointLightSchema.parse(runCheckpoint);

    // Load accumulated_learnings from artifact
    const artifact = await getResearchArtifactById(checkpointArtifactId);
    if (!artifact) {
      logger.warn({ checkpoint_artifact_id: checkpointArtifactId, msg: 'Checkpoint artifact not found, restarting' });
      return null;
    }

    const heavy = ResearchCheckpointArtifactSchema.parse(artifact.payload);

    return {
      depthStack: light.depth_stack,
      visitedEntryIds: new Set(light.visited_entry_ids),
      visitedUrls: new Set(light.visited_urls),
      budgetUsage: light.budget_usage,
      accumulatedLearnings: heavy.accumulated_learnings,
      entriesReadFull: heavy.entries_read_full,
      startedAt: light.started_at,
      currentPhase: light.current_phase ?? 'constraint',
      constraintLearningsCount: light.constraint_learnings_count ?? 0,
      topicKeywords: light.topic_keywords ?? [],
    };
  } catch (err) {
    logger.warn({
      error: err instanceof Error ? err.message : String(err),
      msg: 'Corrupt checkpoint, restarting from scratch',
    });
    return null;
  }
}
