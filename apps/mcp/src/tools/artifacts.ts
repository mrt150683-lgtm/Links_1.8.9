/**
 * Phase 10: MCP Tools - Derived Artifacts
 *
 * Tools for querying AI-generated derived artifacts (tags, entities, summaries).
 * Only available if Phase 7 has been implemented.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as artifactsRepo from '@links/storage';
import { successResponse, errorResponse, ErrorCode } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

/**
 * Tool: list_artifacts_for_entry
 *
 * List all AI-generated artifacts for a specific entry
 */
export const LIST_ARTIFACTS_FOR_ENTRY_TOOL: Tool = {
  name: 'list_artifacts_for_entry',
  description:
    'List all AI-generated derived artifacts (tags, entities, summaries) for a specific entry',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: {
        type: 'string',
        description: 'UUID of the entry to list artifacts for',
      },
    },
    required: ['entry_id'],
    additionalProperties: false,
  },
};

const ListArtifactsForEntryArgsSchema = z
  .object({
    entry_id: z.string().uuid(),
  })
  .strict();

export async function listArtifactsForEntry(args: unknown): Promise<unknown> {
  try {
    const params = ListArtifactsForEntryArgsSchema.parse(args);
    const artifacts = await artifactsRepo.listArtifactsForEntry(params.entry_id);

    return successResponse({ artifacts });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: get_latest_artifact
 *
 * Get the most recent artifact of a specific type for an entry
 */
export const GET_LATEST_ARTIFACT_TOOL: Tool = {
  name: 'get_latest_artifact',
  description:
    'Get the most recent AI-generated artifact of a specific type (tags, entities, summary) for an entry',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: {
        type: 'string',
        description: 'UUID of the entry',
      },
      artifact_type: {
        type: 'string',
        description: 'Type of artifact to retrieve',
        enum: ['tags', 'entities', 'summary'],
      },
    },
    required: ['entry_id', 'artifact_type'],
    additionalProperties: false,
  },
};

const GetLatestArtifactArgsSchema = z
  .object({
    entry_id: z.string().uuid(),
    artifact_type: z.enum(['tags', 'entities', 'summary']),
  })
  .strict();

export async function getLatestArtifact(args: unknown): Promise<unknown> {
  try {
    const params = GetLatestArtifactArgsSchema.parse(args);
    const artifact = await artifactsRepo.getLatestArtifact(
      params.entry_id,
      params.artifact_type
    );

    if (!artifact) {
      return errorResponse(
        ErrorCode.NOT_FOUND,
        `No ${params.artifact_type} artifact found for entry ${params.entry_id}`
      );
    }

    return successResponse({ artifact });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
