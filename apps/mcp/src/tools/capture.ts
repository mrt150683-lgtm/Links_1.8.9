/**
 * Phase 10: MCP Tools - Content Capture
 *
 * Tools for capturing text and links into research pots.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as entriesRepo from '@links/storage';
import { successResponse } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

/**
 * Tool: capture_text
 *
 * Capture text content into a pot
 */
export const CAPTURE_TEXT_TOOL: Tool = {
  name: 'capture_text',
  description:
    'Capture text content (quote, note, excerpt) into a research pot with optional metadata',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to capture into',
      },
      content_text: {
        type: 'string',
        description: 'The text content to capture (1-100,000 chars)',
        minLength: 1,
        maxLength: 100000,
      },
      capture_method: {
        type: 'string',
        description: 'How the content was captured',
        enum: ['manual', 'extension', 'api', 'import', 'mcp'],
      },
      source_url: {
        type: 'string',
        description: 'Optional source URL where content originated',
      },
      source_title: {
        type: 'string',
        description: 'Optional source page/document title',
      },
      notes: {
        type: 'string',
        description: 'Optional user notes about this capture',
        maxLength: 10000,
      },
      captured_at: {
        type: 'number',
        description: 'Unix timestamp (ms) when captured (default: now)',
      },
      client_capture_id: {
        type: 'string',
        description: 'Optional client-side ID for idempotent capture',
      },
    },
    required: ['pot_id', 'content_text', 'capture_method'],
    additionalProperties: false,
  },
};

const CaptureTextArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
    content_text: z.string().min(1).max(100000),
    capture_method: z.enum(['manual', 'extension', 'api', 'import', 'mcp']),
    source_url: z.string().url().optional(),
    source_title: z.string().optional(),
    notes: z.string().max(10000).optional(),
    captured_at: z.number().int().positive().optional(),
    client_capture_id: z.string().optional(),
  })
  .strict();

export async function captureText(args: unknown): Promise<unknown> {
  try {
    const params = CaptureTextArgsSchema.parse(args);

    // If client_capture_id provided, use idempotent create
    if (params.client_capture_id) {
      const result = await entriesRepo.createTextEntryIdempotent({
        pot_id: params.pot_id,
        content_text: params.content_text,
        capture_method: params.capture_method,
        source_url: params.source_url,
        source_title: params.source_title,
        notes: params.notes,
        captured_at: params.captured_at ?? Date.now(),
        client_capture_id: params.client_capture_id,
      });

      return successResponse({
        entry: result.entry,
        created: result.created,
        deduped: result.deduped,
      });
    }

    // Regular create
    const entry = await entriesRepo.createTextEntry({
      pot_id: params.pot_id,
      content_text: params.content_text,
      capture_method: params.capture_method,
      source_url: params.source_url,
      source_title: params.source_title,
      notes: params.notes,
      captured_at: params.captured_at ?? Date.now(),
    });

    return successResponse({ entry, created: true, deduped: false });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: capture_link
 *
 * Capture a link/URL with optional metadata
 */
export const CAPTURE_LINK_TOOL: Tool = {
  name: 'capture_link',
  description:
    'Capture a link/URL into a research pot with optional title and notes. Useful for bookmarking sources.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to capture into',
      },
      source_url: {
        type: 'string',
        description: 'The URL to capture',
      },
      source_title: {
        type: 'string',
        description: 'Optional title/description of the link',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about why this link is relevant',
        maxLength: 10000,
      },
      capture_method: {
        type: 'string',
        description: 'How the link was captured',
        enum: ['manual', 'extension', 'api', 'import', 'mcp'],
      },
      captured_at: {
        type: 'number',
        description: 'Unix timestamp (ms) when captured (default: now)',
      },
      client_capture_id: {
        type: 'string',
        description: 'Optional client-side ID for idempotent capture',
      },
    },
    required: ['pot_id', 'source_url', 'capture_method'],
    additionalProperties: false,
  },
};

const CaptureLinkArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
    source_url: z.string().url(),
    source_title: z.string().optional(),
    notes: z.string().max(10000).optional(),
    capture_method: z.enum(['manual', 'extension', 'api', 'import', 'mcp']),
    captured_at: z.number().int().positive().optional(),
    client_capture_id: z.string().optional(),
  })
  .strict();

export async function captureLink(args: unknown): Promise<unknown> {
  try {
    const params = CaptureLinkArgsSchema.parse(args);

    // Create placeholder text content (just the URL)
    const content_text = params.source_url;

    // If client_capture_id provided, use idempotent create
    if (params.client_capture_id) {
      const result = await entriesRepo.createTextEntryIdempotent({
        pot_id: params.pot_id,
        content_text,
        capture_method: params.capture_method,
        source_url: params.source_url,
        source_title: params.source_title,
        notes: params.notes,
        captured_at: params.captured_at ?? Date.now(),
        client_capture_id: params.client_capture_id,
      });

      return successResponse({
        entry: result.entry,
        created: result.created,
        deduped: result.deduped,
      });
    }

    // Regular create
    const entry = await entriesRepo.createTextEntry({
      pot_id: params.pot_id,
      content_text,
      capture_method: params.capture_method,
      source_url: params.source_url,
      source_title: params.source_title,
      notes: params.notes,
      captured_at: params.captured_at ?? Date.now(),
    });

    return successResponse({ entry, created: true, deduped: false });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
