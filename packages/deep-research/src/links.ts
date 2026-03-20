/**
 * Auto-Link Findings
 *
 * Extracts link candidates from research findings.
 * Throttle rules (v2):
 * - Only create candidate if learning.confidence >= 0.6 OR learning has evidence_excerpts for both entries
 * - max_links_per_run enforced centrally before each insert batch
 */

import type { Learning } from '@links/core';
import type { LinkCandidate } from './types.js';

const MIN_CONFIDENCE_FOR_LINK = 0.6;

/**
 * Extract link candidates from research findings.
 * Returns deduplicated candidates (canonical pair order: smaller ID first).
 */
export function extractLinkCandidates(
  learnings: Learning[],
  maxLinksPerRun: number
): LinkCandidate[] {
  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];

  for (const learning of learnings) {
    if (candidates.length >= maxLinksPerRun) break;

    const entryIds = learning.source_entry_ids;
    if (entryIds.length < 2) continue;

    const hasEvidenceForBoth = (idA: string, idB: string): boolean => {
      if (!learning.evidence_excerpts) return false;
      const ids = new Set(learning.evidence_excerpts.map((e) => e.entry_id));
      return ids.has(idA) && ids.has(idB);
    };

    // Generate pairs
    for (let i = 0; i < entryIds.length; i++) {
      for (let j = i + 1; j < entryIds.length; j++) {
        if (candidates.length >= maxLinksPerRun) break;

        const idA = entryIds[i]!;
        const idB = entryIds[j]!;

        // Throttle: confidence >= 0.6 OR evidence_excerpts for both
        const qualifies =
          learning.confidence >= MIN_CONFIDENCE_FOR_LINK ||
          hasEvidenceForBoth(idA, idB);

        if (!qualifies) continue;

        // Canonical pair key (smaller ID first for dedup)
        const [src, dst] = idA < idB ? [idA, idB] : [idB, idA];
        const pairKey = `${src}::${dst}`;

        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        candidates.push({
          src_entry_id: src,
          dst_entry_id: dst,
          reason: `Research finding: ${learning.text.substring(0, 200)}`,
          confidence: learning.confidence,
          has_evidence_excerpts: hasEvidenceForBoth(idA, idB),
        });
      }
    }
  }

  return candidates;
}
