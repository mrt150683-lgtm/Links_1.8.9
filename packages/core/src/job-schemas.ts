/**
 * Job API request/response schemas
 * Phase 5: Processing Engine
 */

import { z } from 'zod';

/**
 * Job status enum
 */
export const JobStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'dead', 'canceled']);

/**
 * Processing job schema
 */
export const ProcessingJobSchema = z.object({
  id: z.string().uuid(),
  pot_id: z.string().uuid().nullable(),
  entry_id: z.string().uuid().nullable(),
  job_type: z.string(),
  status: JobStatusSchema,
  priority: z.number().int(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  run_after: z.number().int(),
  locked_by: z.string().nullable(),
  locked_at: z.number().int().nullable(),
  last_error: z.string().nullable(),
  payload: z.record(z.unknown()).nullable().optional(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});

export type ProcessingJobDto = z.infer<typeof ProcessingJobSchema>;

/**
 * Enqueue job request
 */
export const EnqueueJobRequestSchema = z.object({
  job_type: z.string().min(1).max(100),
  pot_id: z.string().uuid().optional(),
  entry_id: z.string().uuid().optional(),
  priority: z.number().int().min(-100).max(100).optional().default(0),
  run_after: z.number().int().positive().optional(), // epoch ms
  max_attempts: z.number().int().min(1).max(10).optional().default(3),
  payload: z.record(z.unknown()).optional(),
});

export type EnqueueJobRequest = z.infer<typeof EnqueueJobRequestSchema>;

/**
 * Enqueue job response
 */
export const EnqueueJobResponseSchema = z.object({
  job: ProcessingJobSchema,
});

export type EnqueueJobResponse = z.infer<typeof EnqueueJobResponseSchema>;

/**
 * List jobs query parameters
 */
export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  job_type: z.string().optional(),
  pot_id: z.string().uuid().optional(),
  entry_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

/**
 * List jobs response
 */
export const ListJobsResponseSchema = z.object({
  jobs: z.array(ProcessingJobSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type ListJobsResponse = z.infer<typeof ListJobsResponseSchema>;

/**
 * Run now request (force processing for N minutes)
 */
export const RunNowRequestSchema = z.object({
  minutes: z.number().int().min(1).max(60).default(5),
});

export type RunNowRequest = z.infer<typeof RunNowRequestSchema>;

/**
 * Run now response
 */
export const RunNowResponseSchema = z.object({
  force_run_until: z.number().int(), // epoch ms when override expires
  minutes: z.number().int(),
});

export type RunNowResponse = z.infer<typeof RunNowResponseSchema>;
