import { z } from 'zod';
import { EntryResponseSchema } from './entry-schemas.js';

/**
 * Phase 3: Capture API schemas
 */

/**
 * Thin pot response for capture picker
 */
export const CapturePotSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  last_used_at: z.number().nullable(),
  created_at: z.number(),
});

export type CapturePot = z.infer<typeof CapturePotSchema>;

/**
 * List of pots for capture picker
 */
export const CapturePotsResponseSchema = z.array(CapturePotSchema);

export type CapturePotsResponse = z.infer<typeof CapturePotsResponseSchema>;

/**
 * Capture preferences (all fields optional for PATCH behavior)
 */
export const CapturePreferencesSchema = z.object({
  default_pot_id: z.string().uuid().optional(),
  last_pot_id: z.string().uuid().optional(),
  autosave: z
    .object({
      enabled: z.boolean(),
      pot_overrides: z.record(z.string().uuid(), z.boolean()).optional(),
    })
    .optional(),
  popup: z
    .object({
      pot_list_limit: z.number().int().min(1).max(100).optional(),
      sort_mode: z.literal('recent').optional(),
    })
    .optional(),
});

export type CapturePreferences = z.infer<typeof CapturePreferencesSchema>;

/**
 * Capture text request
 */
export const CaptureTextRequestSchema = z.object({
  pot_id: z.string().uuid(),
  text: z.string(),
  capture_method: z.string().min(1),
  captured_at: z.number().optional(),
  source_url: z.string().url().optional(),
  source_title: z.string().optional(),
  notes: z.string().optional(),
  client_capture_id: z.string().max(128).optional(),
  source_app: z.string().optional(),
  source_context: z.record(z.unknown()).optional(),
});

export type CaptureTextRequest = z.infer<typeof CaptureTextRequestSchema>;

/**
 * Capture text response (Phase 4: uses general EntryResponseSchema)
 */
export const CaptureTextResponseSchema = z.object({
  created: z.boolean(),
  entry: EntryResponseSchema,
  deduped: z.boolean(),
  dedupe_reason: z.enum(['client_capture_id', 'hash_window']).optional(),
});

export type CaptureTextResponse = z.infer<typeof CaptureTextResponseSchema>;

/**
 * Phase 11: Extension capture schemas
 */

/**
 * Extension selection capture request
 * Captures selected text from a web page
 */
export const ExtCaptureSelectionRequestSchema = z.object({
  pot_id: z.string().uuid(),
  text: z.string().min(1).max(200_000), // 200k char limit
  capture_method: z.literal('extension_selection'),
  captured_at: z.number().int().positive().optional(),
  source_url: z.string().url().max(2048).optional(),
  source_title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  client_capture_id: z.string().max(128).optional(),
  source_app: z.literal('chrome_extension').optional(),
  source_context: z.record(z.unknown()).optional(),
});

export type ExtCaptureSelectionRequest = z.infer<typeof ExtCaptureSelectionRequestSchema>;

/**
 * Extension page capture request (link entry)
 * Captures current page as a link entry with optional excerpt
 */
export const ExtCapturePageRequestSchema = z.object({
  pot_id: z.string().uuid(),
  link_url: z.string().url().max(2048),
  link_title: z.string().max(500).optional(),
  content_text: z.string().max(10_000).optional(), // Optional excerpt
  capture_method: z.literal('extension_page'),
  captured_at: z.number().int().positive().optional(),
  notes: z.string().max(5000).optional(),
  client_capture_id: z.string().max(128).optional(),
  source_app: z.literal('chrome_extension').optional(),
  source_context: z.record(z.unknown()).optional(),
});

export type ExtCapturePageRequest = z.infer<typeof ExtCapturePageRequestSchema>;

/**
 * Extension capture response (unified for all capture types)
 */
export const ExtCaptureResponseSchema = z.object({
  created: z.boolean(),
  entry: EntryResponseSchema,
  deduped: z.boolean(),
  dedupe_reason: z.enum(['client_capture_id', 'hash_window']).optional(),
});

export type ExtCaptureResponse = z.infer<typeof ExtCaptureResponseSchema>;
