/**
 * RSS Feed Module Schemas
 * Zod schemas for AI outputs in the RSS discovery pipeline.
 */

import { z } from 'zod';

// ── Feed Discovery AI Output ──────────────────────────────────────────────

export const RssDiscoverFeedSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(200),
  description: z.string().max(1000).optional(),
  // Coerce any frequency string the model returns into our three allowed values
  estimated_frequency: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const lc = v.toLowerCase();
      if (lc.includes('day') || lc.includes('hour')) return 'daily' as const;
      if (lc.includes('week')) return 'weekly' as const;
      return 'irregular' as const;
    })
    .optional(),
  example_titles: z.array(z.string().max(300)).max(10).optional(),
});

export const RssDiscoverResultSchema = z.object({
  keywords: z.array(z.string().max(100)).max(20),
  feeds: z.array(RssDiscoverFeedSchema).max(20),
});

export type RssDiscoverResult = z.infer<typeof RssDiscoverResultSchema>;
export type RssDiscoverFeed = z.infer<typeof RssDiscoverFeedSchema>;
