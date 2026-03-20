/**
 * Phase 10: MCP Tools - Pots Management
 *
 * Tools for managing research pots (vaults).
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as potsRepo from '@links/storage';
import { successResponse, errorResponse, ErrorCode } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

/**
 * Tool: list_pots
 *
 * List all research pots with optional filters
 */
export const LIST_POTS_TOOL: Tool = {
  name: 'list_pots',
  description: 'List all research pots (vaults) ordered by most recently updated',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of pots to return (default: 50)',
        minimum: 1,
        maximum: 1000,
      },
      offset: {
        type: 'number',
        description: 'Number of pots to skip for pagination (default: 0)',
        minimum: 0,
      },
    },
    additionalProperties: false,
  },
};

const ListPotsArgsSchema = z
  .object({
    limit: z.number().int().min(1).max(1000).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

export async function listPots(args: unknown): Promise<unknown> {
  try {
    const params = ListPotsArgsSchema.parse(args);
    const pots = await potsRepo.listPots(params.limit, params.offset);

    return successResponse({ pots });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: create_pot
 *
 * Create a new research pot
 */
export const CREATE_POT_TOOL: Tool = {
  name: 'create_pot',
  description: 'Create a new research pot (vault) for organizing captured content',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the pot (1-200 chars)',
        minLength: 1,
        maxLength: 200,
      },
      description: {
        type: 'string',
        description: 'Optional description of the pot purpose',
        maxLength: 2000,
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

const CreatePotArgsSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
  })
  .strict();

export async function createPot(args: unknown): Promise<unknown> {
  try {
    const params = CreatePotArgsSchema.parse(args);
    const pot = await potsRepo.createPot({
      name: params.name,
      description: params.description,
    });

    return successResponse({ pot });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: get_pot
 *
 * Get details for a specific pot by ID
 */
export const GET_POT_TOOL: Tool = {
  name: 'get_pot',
  description: 'Get detailed information about a specific research pot by ID',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to retrieve',
      },
    },
    required: ['pot_id'],
    additionalProperties: false,
  },
};

const GetPotArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
  })
  .strict();

export async function getPot(args: unknown): Promise<unknown> {
  try {
    const params = GetPotArgsSchema.parse(args);
    const pot = await potsRepo.getPotById(params.pot_id);

    if (!pot) {
      return errorResponse(ErrorCode.NOT_FOUND, `Pot not found: ${params.pot_id}`);
    }

    return successResponse({ pot });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: delete_pot
 *
 * Delete a pot and all its contents (entries, assets, artifacts, links)
 */
export const DELETE_POT_TOOL: Tool = {
  name: 'delete_pot',
  description:
    'Delete a research pot and all its contents (entries, assets, artifacts, links). This is irreversible.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to delete',
      },
      confirm_name: {
        type: 'string',
        description: 'Pot name to confirm deletion (safety check)',
      },
    },
    required: ['pot_id', 'confirm_name'],
    additionalProperties: false,
  },
};

const DeletePotArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
    confirm_name: z.string(),
  })
  .strict();

export async function deletePot(args: unknown): Promise<unknown> {
  try {
    const params = DeletePotArgsSchema.parse(args);

    // Get pot to verify name
    const pot = await potsRepo.getPotById(params.pot_id);
    if (!pot) {
      return errorResponse(ErrorCode.NOT_FOUND, `Pot not found: ${params.pot_id}`);
    }

    // Verify confirmation name
    if (pot.name !== params.confirm_name) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        `Confirmation name does not match. Expected: "${pot.name}"`
      );
    }

    // Delete pot
    const deleted = await potsRepo.deletePot(params.pot_id);
    if (!deleted) {
      return errorResponse(ErrorCode.NOT_FOUND, `Pot not found: ${params.pot_id}`);
    }

    return successResponse({ deleted: true, pot_id: params.pot_id });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
