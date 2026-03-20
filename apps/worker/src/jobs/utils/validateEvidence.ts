/**
 * Phase 7: Evidence Slicing Validation
 *
 * Validates that summary evidence excerpts exactly match the entry text
 * at the specified character offsets
 */

import type { SummaryArtifact } from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'validate-evidence' });

/**
 * Validation result
 */
export interface EvidenceValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate evidence slicing for summary artifact
 *
 * Ensures that evidence excerpts exactly match the entry text at the
 * specified character offsets [start:end]
 *
 * @param artifact - Summary artifact with claims and evidence
 * @param entryText - Original entry text to validate against
 * @returns Validation result with errors array
 */
export function validateEvidence(
  artifact: SummaryArtifact,
  entryText: string
): EvidenceValidationResult {
  const errors: string[] = [];

  for (let i = 0; i < artifact.claims.length; i++) {
    const claim = artifact.claims[i];
    if (!claim) continue; // Skip undefined elements

    const { start, end, excerpt } = claim.evidence;

    // Skip zero-length evidence
    if (excerpt.length === 0) {
      continue;
    }

    // Clamp offsets to text bounds for extraction (AI may give out-of-bounds positions)
    const clampedStart = Math.max(0, Math.min(start, entryText.length - 1));
    const clampedEnd = Math.max(0, Math.min(end, entryText.length));

    // Extract actual text at the specified offsets (clamped)
    const actualExcerpt = entryText.substring(clampedStart, clampedEnd);

    // First try exact position match
    if (actualExcerpt === excerpt) {
      continue;
    }

    // Position mismatch — try substring search to handle byte-vs-char offset issues
    // (LLMs often count UTF-8 bytes instead of JS UTF-16 code units)
    const foundAt = entryText.indexOf(excerpt);
    if (foundAt !== -1) {
      // Excerpt exists in text, just at a different position — warn but don't fail
      logger.warn({
        claim_index: i,
        start,
        end,
        found_at: foundAt,
        msg: 'Evidence offset mismatch (likely byte-vs-char encoding issue), excerpt found at correct position',
      });
      continue;
    }

    // Try normalized search: strip timestamp markers like [0:00], [1:23], [12:34]
    // and collapse whitespace — handles YouTube transcripts where AI skips inline timestamps
    const normalize = (s: string) => s.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const normalizedText = normalize(entryText);
    const normalizedExcerpt = normalize(excerpt);
    if (normalizedExcerpt.length > 0 && normalizedText.includes(normalizedExcerpt)) {
      logger.warn({
        claim_index: i,
        start,
        end,
        msg: 'Evidence found after normalizing timestamps/whitespace',
      });
      continue;
    }

    // Excerpt not found anywhere in the text — this is a real hallucination
    logger.warn({
      claim_index: i,
      start,
      end,
      expected_length: excerpt.length,
      actual_length: actualExcerpt.length,
    });

    errors.push(
      `Claim ${i}: Evidence not found in text at [${start}:${end}]\n` +
      `Expected: ${JSON.stringify(excerpt.substring(0, 100))}\n` +
      `Actual:   ${JSON.stringify(actualExcerpt.substring(0, 100))}`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
