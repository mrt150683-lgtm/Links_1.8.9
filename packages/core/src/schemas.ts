import { z } from 'zod';

/**
 * Expanded health response (Phase 12)
 */
export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  time: z.number(),
  database: z.object({
    connected: z.boolean(),
    migration_version: z.number(),
  }),
  worker: z
    .object({
      last_heartbeat: z.number().nullable(),
      status: z.enum(['running', 'idle', 'stopped', 'unknown']),
    })
    .optional(),
  model_registry: z.object({
    fetched_at: z.number().nullable(),
    age_hours: z.number().nullable(),
  }),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  request_id: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
