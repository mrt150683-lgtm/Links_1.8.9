/**
 * Phase 10: MCP Tools - Processing Jobs
 *
 * Tools for managing background processing jobs (tagging, entity extraction, etc.).
 * Only available if Phase 5 has been implemented.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as jobsRepo from '@links/storage';
import { successResponse } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

/**
 * Tool: enqueue_processing
 *
 * Enqueue a background processing job for an entry
 */
export const ENQUEUE_PROCESSING_TOOL: Tool = {
  name: 'enqueue_processing',
  description:
    'Enqueue a background processing job (tagging, entity extraction, summary generation) for an entry',
  inputSchema: {
    type: 'object',
    properties: {
      job_type: {
        type: 'string',
        description: 'Type of processing job to enqueue',
        enum: ['extract_tags', 'extract_entities', 'generate_summary', 'discover_links'],
      },
      entry_id: {
        type: 'string',
        description: 'UUID of the entry to process',
      },
      pot_id: {
        type: 'string',
        description: 'UUID of the pot (required for some job types)',
      },
      priority: {
        type: 'number',
        description: 'Job priority (higher = runs sooner, default: 0)',
        default: 0,
      },
      run_after: {
        type: 'number',
        description: 'Unix timestamp (ms) to delay job until (default: now)',
      },
    },
    required: ['job_type'],
    additionalProperties: false,
  },
};

const EnqueueProcessingArgsSchema = z
  .object({
    job_type: z.enum(['extract_tags', 'extract_entities', 'generate_summary', 'discover_links']),
    entry_id: z.string().uuid().optional(),
    pot_id: z.string().uuid().optional(),
    priority: z.number().int().default(0),
    run_after: z.number().int().positive().optional(),
  })
  .strict();

export async function enqueueProcessing(args: unknown): Promise<unknown> {
  try {
    const params = EnqueueProcessingArgsSchema.parse(args);
    const job = await jobsRepo.enqueueJob({
      job_type: params.job_type,
      pot_id: params.pot_id,
      entry_id: params.entry_id,
      priority: params.priority,
      run_after: params.run_after,
    });

    return successResponse({ job });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: run_processing_now
 *
 * Enqueue a high-priority job for immediate processing
 */
export const RUN_PROCESSING_NOW_TOOL: Tool = {
  name: 'run_processing_now',
  description:
    'Enqueue a high-priority processing job for immediate execution (bypasses normal queue)',
  inputSchema: {
    type: 'object',
    properties: {
      job_type: {
        type: 'string',
        description: 'Type of processing job to run',
        enum: ['extract_tags', 'extract_entities', 'generate_summary', 'discover_links'],
      },
      entry_id: {
        type: 'string',
        description: 'UUID of the entry to process',
      },
      pot_id: {
        type: 'string',
        description: 'UUID of the pot (required for some job types)',
      },
    },
    required: ['job_type'],
    additionalProperties: false,
  },
};

const RunProcessingNowArgsSchema = z
  .object({
    job_type: z.enum(['extract_tags', 'extract_entities', 'generate_summary', 'discover_links']),
    entry_id: z.string().uuid().optional(),
    pot_id: z.string().uuid().optional(),
  })
  .strict();

export async function runProcessingNow(args: unknown): Promise<unknown> {
  try {
    const params = RunProcessingNowArgsSchema.parse(args);
    const now = Date.now();

    // Enqueue with high priority and run_after=now
    const job = await jobsRepo.enqueueJob({
      job_type: params.job_type,
      pot_id: params.pot_id,
      entry_id: params.entry_id,
      priority: 1000, // High priority
      run_after: now,
    });

    return successResponse({ job });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
