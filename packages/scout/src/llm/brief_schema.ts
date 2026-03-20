import { z } from 'zod';

export const BriefOutputSchema = z.object({
  title: z.string().max(100),
  concept: z.string().max(600),
  repos: z
    .array(
      z.object({
        full_name: z.string(),
        why_it_fits: z.string().max(300),
        integration_role: z.string().max(100),
      })
    )
    .min(2)
    .max(4),
  outreach_message: z.string().max(1000),
});

export type BriefOutput = z.infer<typeof BriefOutputSchema>;

export function validateBriefOutput(raw: unknown): BriefOutput {
  return BriefOutputSchema.parse(raw);
}
