import { z } from 'zod';

export const ConfigSchema = z.object({
  CS_DB_PATH: z.string().optional(),
  CS_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  GITHUB_TOKEN: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** Functional overlap threshold above which a candidate pair is treated as competitors (0–1). */
  CS_OVERLAP_THRESHOLD: z.string().optional().default('0.70').transform((v) => parseFloat(v)),
  /** Score penalty subtracted from overlap_score when an interop exception is triggered (0–1). */
  CS_OVERLAP_EXCEPTION_PENALTY: z.string().optional().default('0.10').transform((v) => parseFloat(v)),
  /** Number of top-scoring pairs to export as separate TOP_OPPORTUNITY_N.md files. */
  CS_TOP_OPPORTUNITIES: z.string().optional().default('3').transform((v) => parseInt(v, 10)),
  /** Max number of top-scored historical repos (from previous runs) to inject into brief generation. 0 = disabled. */
  CS_HISTORY_CANDIDATES: z.string().optional().default('100').transform((v) => parseInt(v, 10)),
  /** Port for the Forge independent service. */
  FORGE_PORT: z.string().optional().default('4001').transform((v) => parseInt(v, 10)),
  /** Suffix for the Forge database file if desired. */
  FORGE_DB_SUFFIX: z.string().optional().default('_forge'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const REQUIRED_FOR_REAL_RUNS = ['GITHUB_TOKEN', 'OPENROUTER_API_KEY'] as const;
export const SECRET_KEY_PATTERNS = /token|key|secret|password|authorization/i;
