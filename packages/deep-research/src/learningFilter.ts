/**
 * Learning Filter
 *
 * Validates and filters learnings based on evidence requirements.
 * Drops learnings that have no provenance (no sources and no source_entry_ids).
 */

import type { Learning } from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'deep-research:learningFilter' });

export function validateAndFilterLearnings(
  learnings: Learning[],
  runId: string,
  requireEvidence: boolean,
  defaultKind: 'constraint' | 'research'
): Learning[] {
  const filtered: Learning[] = [];

  for (const learning of learnings) {
    // Set kind if missing (default from phase)
    if (!learning.kind) {
      (learning as { kind: string }).kind = defaultKind;
    }

    // Drop learnings with no provenance when evidence is required
    if (requireEvidence) {
      const hasSources = learning.sources && learning.sources.length > 0;
      const hasEntryIds = learning.source_entry_ids && learning.source_entry_ids.length > 0;

      if (!hasSources && !hasEntryIds) {
        logger.info({
          run_id: runId,
          dropped_learning: learning.text.substring(0, 80),
          msg: 'Dropped learning with no provenance',
        });
        continue;
      }
    }

    filtered.push(learning);
  }

  if (filtered.length < learnings.length) {
    logger.info({
      run_id: runId,
      original_count: learnings.length,
      filtered_count: filtered.length,
      msg: 'Learnings filtered by evidence requirement',
    });
  }

  return filtered;
}
