/**
 * Phase 12: Diagnostics Schemas
 *
 * Schemas for system diagnostics.
 */

import { z } from 'zod';

/**
 * Detailed diagnostics response
 */
export const DiagnosticsResponseSchema = z.object({
  database: z.object({
    path: z.string(),
    wal_mode: z.boolean(),
    synchronous: z.string(),
    migration_version: z.number(),
  }),
  job_queue: z.object({
    queued: z.number(),
    running: z.number(),
    failed: z.number(),
    dead: z.number(),
  }),
  asset_store: z.object({
    blob_count: z.number(),
    orphan_count: z.number(),
  }),
  model_registry: z.object({
    fetched_at: z.number().nullable(),
    age_ms: z.number().nullable(),
    model_count: z.number(),
  }),
});

export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
