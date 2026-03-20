/**
 * Topic Guard
 *
 * Filters out off-topic research learnings using keyword matching.
 * Constraint-kind learnings always pass (they define the domain).
 * Research-kind learnings must mention at least one topic keyword.
 */

import type { Learning } from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'deep-research:topicGuard' });

export function topicGuard(
  learnings: Learning[],
  topicKeywords: string[],
  enabled: boolean,
  runId: string
): Learning[] {
  if (!enabled || topicKeywords.length === 0) return learnings;

  const lowerKeywords = topicKeywords.map((k) => k.toLowerCase());
  const filtered: Learning[] = [];

  for (const learning of learnings) {
    // Constraint learnings always pass
    if (learning.kind === 'constraint') {
      filtered.push(learning);
      continue;
    }

    // Research learnings must contain at least one keyword
    const textLower = learning.text.toLowerCase();
    const matchesKeyword = lowerKeywords.some((kw) => textLower.includes(kw));

    if (matchesKeyword) {
      filtered.push(learning);
    } else {
      logger.info({
        run_id: runId,
        dropped_learning: learning.text.substring(0, 80),
        msg: 'Topic guard dropped off-topic learning',
      });
    }
  }

  if (filtered.length < learnings.length) {
    logger.info({
      run_id: runId,
      original_count: learnings.length,
      filtered_count: filtered.length,
      keywords_count: topicKeywords.length,
      msg: 'Topic guard filtered learnings',
    });
  }

  return filtered;
}
