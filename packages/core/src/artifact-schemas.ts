/**
 * Phase 7: Derived Artifact Schemas
 *
 * Strict Zod schemas for AI-generated artifacts:
 * - Tags: topic labels, method labels, domain labels, sentiment
 * - Entities: people, organizations, places, concepts, events
 * - Summary: overview, key points, evidence-based claims
 *
 * All schemas enforce evidence-first discipline:
 * - Max limits to prevent bloat
 * - Confidence scores for all items
 * - Evidence excerpts with character offsets for claims
 */

import { z } from 'zod';

/**
 * Tag schema
 * Represents a single topic tag extracted from entry content
 */
export const TagSchema = z.object({
  label: z.string().min(1).max(100),
  type: z.enum(['topic', 'method', 'domain', 'sentiment', 'other']),
  confidence: z.number().min(0).max(1),
});

/**
 * Tags artifact payload schema
 * Max 20 tags to prevent bloat
 */
export const TagsArtifactSchema = z.object({
  tags: z.array(TagSchema).max(20),
});

/**
 * Entity schema
 * Represents a single named entity extracted from entry content
 */
export const EntitySchema = z.object({
  label: z.string().min(1).max(200),
  type: z.enum(['person', 'org', 'place', 'concept', 'event', 'other']),
  confidence: z.number().min(0).max(1),
});

/**
 * Entities artifact payload schema
 * Max 30 entities to prevent bloat
 */
export const EntitiesArtifactSchema = z.object({
  entities: z.array(EntitySchema).max(30),
});

/**
 * Evidence schema
 * Represents an exact excerpt from entry text with character offsets
 *
 * CRITICAL: excerpt MUST match entry.content_text.substring(start, end)
 * This is validated separately to prevent hallucination
 */
export const EvidenceSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  excerpt: z.string().min(1),
});

/**
 * Claim schema
 * Represents a single claim with evidence from the entry text
 */
export const ClaimSchema = z.object({
  claim: z.string().min(1).max(500),
  evidence: EvidenceSchema,
});

/**
 * Summary artifact payload schema
 * Evidence-based summary with key points and claims
 *
 * - summary: concise overview (max 800 chars)
 * - bullets: key points (max 8)
 * - claims: important statements with evidence (max 8)
 *
 * All claims MUST include evidence excerpts that exactly match
 * substrings from the entry text at the specified offsets.
 */
export const SummaryArtifactSchema = z.object({
  summary: z.string().min(1).max(800),
  bullets: z.array(z.string().min(1).max(200)).max(8),
  claims: z.array(ClaimSchema).max(8),
});

/**
 * Type exports
 */
export type Tag = z.infer<typeof TagSchema>;
export type TagsArtifact = z.infer<typeof TagsArtifactSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type EntitiesArtifact = z.infer<typeof EntitiesArtifactSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type SummaryArtifact = z.infer<typeof SummaryArtifactSchema>;

/**
 * Transcript segment schema
 * Optional time-stamped segment from audio transcription
 */
export const TranscriptSegmentSchema = z.object({
  start: z.number().optional(),
  end: z.number().optional(),
  text: z.string().min(1),
});

/**
 * Extracted text artifact payload schema
 * Covers audio transcription (and future doc OCR / PDF extraction)
 *
 * - text: full transcript / extracted text
 * - language: detected language code (optional)
 * - segments: time-stamped segments (optional, audio only)
 */
export const ExtractedTextArtifactSchema = z.object({
  text: z.string().min(1),
  language: z.string().optional(),
  segments: z.array(TranscriptSegmentSchema).optional(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type ExtractedTextArtifact = z.infer<typeof ExtractedTextArtifactSchema>;

/**
 * Date mention schema
 * Represents a single date extracted from entry content
 */
export const DateMentionSchema = z.object({
  date: z.string(), // YYYY-MM-DD format
  confidence: z.number().min(0).max(1),
  evidence: EvidenceSchema,
});

/**
 * Date mentions artifact payload schema
 * Stores extracted dates from entry content
 */
export const DateMentionsArtifactSchema = z.object({
  dates: z.array(DateMentionSchema).max(50),
});

export type DateMention = z.infer<typeof DateMentionSchema>;
export type DateMentionsArtifact = z.infer<typeof DateMentionsArtifactSchema>;

/**
 * Artifact type union for runtime validation
 */
export type ArtifactPayload = TagsArtifact | EntitiesArtifact | SummaryArtifact | ExtractedTextArtifact | DateMentionsArtifact;

/**
 * Get schema by artifact type
 */
export function getArtifactSchema(type: 'tags' | 'entities' | 'summary' | 'extracted_text' | 'date_mentions'): z.ZodType {
  switch (type) {
    case 'tags':
      return TagsArtifactSchema;
    case 'entities':
      return EntitiesArtifactSchema;
    case 'summary':
      return SummaryArtifactSchema;
    case 'extracted_text':
      return ExtractedTextArtifactSchema;
    case 'date_mentions':
      return DateMentionsArtifactSchema;
  }
}

/**
 * Validate evidence excerpts match entry text exactly
 *
 * For summary artifacts, this validates that all claim evidence excerpts
 * are exact substrings of the entry content at the specified offsets.
 *
 * @param artifact - The validated summary artifact payload
 * @param entryText - The original entry content_text
 * @returns Array of validation errors (empty if valid)
 */
export function validateEvidenceSlicing(
  artifact: SummaryArtifact,
  entryText: string
): string[] {
  const errors: string[] = [];

  for (let i = 0; i < artifact.claims.length; i++) {
    const claim = artifact.claims[i];
    if (!claim) continue; // Skip undefined elements
    const { start, end, excerpt } = claim.evidence;

    // Validate offsets are in bounds
    if (start < 0 || start >= entryText.length) {
      errors.push(`Claim ${i}: start offset ${start} out of bounds (text length: ${entryText.length})`);
      continue;
    }

    if (end < start || end > entryText.length) {
      errors.push(`Claim ${i}: end offset ${end} invalid (start: ${start}, text length: ${entryText.length})`);
      continue;
    }

    // Extract actual substring from entry text
    const actualExcerpt = entryText.substring(start, end);

    // Validate exact match
    if (actualExcerpt !== excerpt) {
      errors.push(
        `Claim ${i}: evidence excerpt mismatch at [${start}:${end}]\n` +
        `  Expected: "${excerpt}"\n` +
        `  Actual:   "${actualExcerpt}"`
      );
    }
  }

  return errors;
}

/**
 * Validate date mention evidence excerpts match entry text exactly
 *
 * For date mentions artifacts, this validates that all date evidence excerpts
 * are exact substrings of the entry content at the specified offsets.
 *
 * @param artifact - The validated date mentions artifact payload
 * @param entryText - The original entry content_text
 * @returns Array of validation errors (empty if valid)
 */
export function validateDateMentionEvidence(
  artifact: DateMentionsArtifact,
  entryText: string
): string[] {
  const errors: string[] = [];

  for (let i = 0; i < artifact.dates.length; i++) {
    const mention = artifact.dates[i];
    if (!mention) continue; // Skip undefined elements
    const { start, end, excerpt } = mention.evidence;

    // Validate offsets are in bounds
    if (start < 0 || start >= entryText.length) {
      errors.push(`Date ${i}: start offset ${start} out of bounds (text length: ${entryText.length})`);
      continue;
    }

    if (end < start || end > entryText.length) {
      errors.push(`Date ${i}: end offset ${end} invalid (start: ${start}, text length: ${entryText.length})`);
      continue;
    }

    // Extract actual substring from entry text
    const actualExcerpt = entryText.substring(start, end);

    // Validate exact match
    if (actualExcerpt !== excerpt) {
      errors.push(
        `Date ${i}: evidence excerpt mismatch at [${start}:${end}]\n` +
        `  Expected: "${excerpt}"\n` +
        `  Actual:   "${actualExcerpt}"`
      );
    }
  }

  return errors;
}
