import { z } from 'zod';

export const RepoAnalysisOutputSchema = z.object({
  repo: z.object({
    full_name: z.string(),
  }),
  scores: z.object({
    interestingness: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
    collaboration_potential: z.number().min(0).max(1),
  }),
  reasons: z.object({
    interestingness: z.array(z.string()).max(8),
    novelty: z.array(z.string()).max(8),
    collaboration_potential: z.array(z.string()).max(8),
  }),
  signals: z.object({
    problem_summary: z.string().optional(),
    who_is_it_for: z.string().optional(),
    integration_surface: z.array(z.string()).optional(),
    risk_flags: z.array(z.string()).optional(),
  }),
  keywords: z.object({
    primary: z.array(z.string()).max(12),
    secondary: z.array(z.string()).max(24),
    search_queries: z.array(z.string()).max(10),
  }),
});

export type RepoAnalysisOutput = z.infer<typeof RepoAnalysisOutputSchema>;

export function validateRepoAnalysisOutput(raw: unknown): RepoAnalysisOutput {
  return RepoAnalysisOutputSchema.parse(raw);
}
