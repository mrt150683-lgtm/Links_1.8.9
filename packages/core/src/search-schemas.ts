/**
 * Phase 12: Search Schemas
 *
 * Request and response schemas for full-text search within a pot.
 * Extended to cover: entry content, tags, entities, summaries,
 * connections (links) and generated intelligence (Q&A).
 */

import { z } from 'zod';

/**
 * Search request query parameters
 */
export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: z.enum(['text', 'image', 'doc', 'link']).optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  has_assets: z.coerce.boolean().optional(),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * What matched in the entry result
 * - content    : matched entry content_text / link_url / source_title etc.
 * - tag        : matched a derived tag label
 * - entity     : matched a derived entity name
 * - summary    : matched a derived summary text
 * - connection : matched a link's rationale or type
 */
export const MatchTypeSchema = z.enum([
  'content',
  'tag',
  'entity',
  'summary',
  'connection',
]);
export type MatchType = z.infer<typeof MatchTypeSchema>;

/**
 * Single entry search result (any match type)
 */
export const SearchResultItemSchema = z.object({
  entry_id: z.string().uuid(),
  type: z.enum(['text', 'image', 'doc', 'link']),
  snippet: z.string(),
  score: z.number(),
  captured_at: z.number(),
  source_url: z.string().nullable().optional(),
  source_title: z.string().nullable().optional(),
  has_asset: z.boolean().optional(),
  /** What caused this entry to appear in results */
  match_type: MatchTypeSchema.optional().default('content'),
  /** The matched value e.g. tag label or entity name */
  matched_value: z.string().optional(),
});

export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

/**
 * Intelligence (generated Q&A) search result
 */
export const IntelligenceSearchResultSchema = z.object({
  question_id: z.string().uuid(),
  question_text: z.string(),
  answer_text: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  entry_ids: z.array(z.string().uuid()),
  /** What part of the intelligence item matched */
  match_type: z.enum(['question', 'answer']),
});

export type IntelligenceSearchResult = z.infer<typeof IntelligenceSearchResultSchema>;

/**
 * Search response
 */
export const SearchResponseSchema = z.object({
  q: z.string(),
  pot_id: z.string().uuid(),
  results: z.array(SearchResultItemSchema),
  intelligence_results: z.array(IntelligenceSearchResultSchema),
  total: z.number().int().min(0),
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
