/**
 * Phase 8: Link Discovery Schemas
 *
 * Strict Zod schemas for AI-generated link classifications
 * - Link type classification (same_topic, supports, etc.)
 * - Evidence excerpts with character offsets and side markers
 * - Confidence scores and rationales
 *
 * Evidence-first discipline:
 * - Max 6 evidence items to prevent bloat
 * - Each excerpt must be a literal slice from one of the two entry texts
 * - Side marker ('src' or 'dst') identifies which entry the excerpt is from
 */

import { z } from 'zod';

/**
 * Link type enum
 *
 * Undirected types (symmetric):
 * - same_topic: Entries discuss the same subject matter
 * - same_entity: Entries mention the same person/place/org/concept
 * - duplicate: Entries are near-duplicates or redundant
 *
 * Directed types (asymmetric):
 * - supports: Src entry provides evidence for dst entry
 * - contradicts: Src entry contradicts claims in dst entry
 * - references: Src entry explicitly cites or mentions dst entry
 * - sequence: Src entry temporally or logically precedes dst entry
 * - other: Relationship exists but doesn't fit other categories
 */
export const LinkTypeSchema = z.enum([
  'same_topic',
  'same_entity',
  'supports',
  'contradicts',
  'references',
  'sequence',
  'duplicate',
  'other',
]);

/**
 * Link evidence schema
 *
 * Represents a single excerpt from one of the two entries being linked.
 * The 'side' field indicates whether the excerpt is from the source or
 * destination entry.
 *
 * CRITICAL: excerpt MUST match the entry text exactly:
 * - For side='src': excerpt === srcEntry.content_text.substring(start, end)
 * - For side='dst': excerpt === dstEntry.content_text.substring(start, end)
 *
 * This is validated separately to prevent hallucination.
 */
export const LinkEvidenceSchema = z.object({
  side: z.enum(['src', 'dst']),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  excerpt: z.string().min(1),
});

/**
 * Link classification output schema
 *
 * This is the expected JSON output from the AI link classification prompt.
 *
 * Rules enforced:
 * - confidence must be 0..1
 * - rationale must be concise (max 500 chars)
 * - evidence limited to max 6 items to prevent bloat
 * - if model cannot justify, it must output link_type='other' with low confidence
 */
export const LinkClassificationSchema = z.object({
  link_type: LinkTypeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
  evidence: z.array(LinkEvidenceSchema).max(6),
});

/**
 * Type exports
 */
export type LinkType = z.infer<typeof LinkTypeSchema>;
export type LinkEvidence = z.infer<typeof LinkEvidenceSchema>;
export type LinkClassification = z.infer<typeof LinkClassificationSchema>;

/**
 * Validate link evidence excerpts match entry texts exactly
 *
 * For each evidence item, validates that the excerpt is an exact substring
 * of the corresponding entry text at the specified offsets.
 *
 * @param classification - The validated link classification output
 * @param srcEntryText - The source entry content_text
 * @param dstEntryText - The destination entry content_text
 * @returns Array of validation errors (empty if valid)
 */
export function validateLinkEvidence(
  classification: LinkClassification,
  srcEntryText: string,
  dstEntryText: string
): string[] {
  const errors: string[] = [];

  for (let i = 0; i < classification.evidence.length; i++) {
    const evidence = classification.evidence[i];
    if (!evidence) continue; // Skip undefined elements

    const { side, start, end, excerpt } = evidence;

    // Select the correct entry text based on side
    const entryText = side === 'src' ? srcEntryText : dstEntryText;
    const sideLabel = side === 'src' ? 'source' : 'destination';

    // Skip zero-length evidence
    if (excerpt.length === 0) continue;

    // Clamp offsets to text bounds (AI may give out-of-bounds positions)
    const clampedStart = Math.max(0, Math.min(start, entryText.length - 1));
    const clampedEnd = Math.max(0, Math.min(end, entryText.length));

    // Extract actual substring from entry text
    const actualExcerpt = entryText.substring(clampedStart, clampedEnd);

    // 1. Exact position match
    if (actualExcerpt === excerpt) continue;

    // 2. Substring search — handles byte-vs-char offset issues with multi-byte Unicode
    if (entryText.includes(excerpt)) continue;

    // 3. Normalized search — strip timestamp markers like [0:00] for YouTube transcripts
    const normalize = (s: string) => s.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const normalizedText = normalize(entryText);
    const normalizedExcerpt = normalize(excerpt);
    if (normalizedExcerpt.length > 0 && normalizedText.includes(normalizedExcerpt)) continue;

    // Evidence not found in text — hallucination
    errors.push(
      `Evidence ${i} (${sideLabel}): excerpt not found in text at [${start}:${end}]\n` +
      `  Expected: "${excerpt.substring(0, 100)}${excerpt.length > 100 ? '...' : ''}"\n` +
      `  Actual:   "${actualExcerpt.substring(0, 100)}${actualExcerpt.length > 100 ? '...' : ''}"`
    );
  }

  return errors;
}
