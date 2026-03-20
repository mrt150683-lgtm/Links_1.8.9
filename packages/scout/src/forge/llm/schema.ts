import { z } from 'zod';

export const ForgeRepoSeedOutputSchema = z.object({
  summary: z.string(),
  audience: z.string(),
  keywords: z.array(z.string()),
  search_queries: z.array(z.string()),
});

export type ForgeRepoSeedOutput = z.infer<typeof ForgeRepoSeedOutputSchema>;

export const ForgeKeywordStormOutputSchema = z.object({
  concept_analysis: z.string(),
  keywords: z.array(z.string()),
  search_queries: z.array(z.string()),
});

export type ForgeKeywordStormOutput = z.infer<typeof ForgeKeywordStormOutputSchema>;
