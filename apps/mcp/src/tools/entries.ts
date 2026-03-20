/**
 * Phase 10: MCP Tools - Entries Management
 *
 * Tools for querying captured entries.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as entriesRepo from '@links/storage';
import { successResponse, errorResponse, ErrorCode } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

/**
 * Tool: list_entries
 *
 * List entries in a pot with optional filters
 */
export const LIST_ENTRIES_TOOL: Tool = {
  name: 'list_entries',
  description:
    'List captured entries in a research pot with optional filters (capture method, source URL)',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to list entries from',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of entries to return (default: 100)',
        minimum: 1,
        maximum: 1000,
      },
      offset: {
        type: 'number',
        description: 'Number of entries to skip for pagination (default: 0)',
        minimum: 0,
      },
      capture_method: {
        type: 'string',
        description: 'Optional filter by capture method',
        enum: ['manual', 'extension', 'api', 'import', 'mcp'],
      },
      source_url: {
        type: 'string',
        description: 'Optional filter by source URL',
      },
    },
    required: ['pot_id'],
    additionalProperties: false,
  },
};

const ListEntriesArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
    limit: z.number().int().min(1).max(1000).default(100),
    offset: z.number().int().min(0).default(0),
    capture_method: z.enum(['manual', 'extension', 'api', 'import', 'mcp']).optional(),
    source_url: z.string().url().optional(),
  })
  .strict();

export async function listEntries(args: unknown): Promise<unknown> {
  try {
    const params = ListEntriesArgsSchema.parse(args);
    const entries = await entriesRepo.listEntries({
      pot_id: params.pot_id,
      limit: params.limit,
      offset: params.offset,
      capture_method: params.capture_method,
      source_url: params.source_url,
    });

    return successResponse({ entries });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: get_entry
 *
 * Get full details for a specific entry by ID
 */
export const GET_ENTRY_TOOL: Tool = {
  name: 'get_entry',
  description: 'Get detailed information about a specific captured entry by ID',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: {
        type: 'string',
        description: 'UUID of the entry to retrieve',
      },
    },
    required: ['entry_id'],
    additionalProperties: false,
  },
};

const GetEntryArgsSchema = z
  .object({
    entry_id: z.string().uuid(),
  })
  .strict();

export async function getEntry(args: unknown): Promise<unknown> {
  try {
    const params = GetEntryArgsSchema.parse(args);
    const entry = await entriesRepo.getEntryById(params.entry_id);

    if (!entry) {
      return errorResponse(ErrorCode.NOT_FOUND, `Entry not found: ${params.entry_id}`);
    }

    return successResponse({ entry });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
