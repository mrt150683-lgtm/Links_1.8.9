import { z } from 'zod';
import { AssetResponseSchema } from './asset-schemas.js';

// Request schemas
export const CreateTextEntryRequestSchema = z.object({
  text: z.string().min(1),
  capture_method: z.string().min(1).max(50),
  source_url: z.string().url().optional(),
  source_title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  captured_at: z.number().int().positive().optional(),
});

export const ListEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  capture_method: z.string().optional(),
  source_url: z.string().optional(),
});

// Response schemas
export const EntryResponseSchema = z.object({
  id: z.string().uuid(),
  pot_id: z.string().uuid(),
  type: z.enum(['text', 'image', 'doc', 'link', 'audio', 'chat']),
  content_text: z.string().nullable(), // Phase 4: nullable for asset-backed entries
  content_sha256: z.string().nullable(), // Phase 4: nullable for asset-backed entries
  capture_method: z.string(),
  source_url: z.string().nullable(),
  source_title: z.string().nullable(),
  notes: z.string().nullable(),
  captured_at: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
  // Phase 3: idempotency and metadata
  client_capture_id: z.string().nullable().optional(),
  source_app: z.string().nullable().optional(),
  source_context: z.record(z.unknown()).nullable().optional(),
  // Phase 4: asset reference
  asset_id: z.string().uuid().nullable().optional(),
  asset: AssetResponseSchema.optional(), // Phase 4: embedded asset metadata
  // Phase 11: link fields
  link_url: z.string().nullable().optional(),
  link_title: z.string().nullable().optional(),
});

export const EntryListResponseSchema = z.object({
  entries: z.array(EntryResponseSchema),
  total: z.number(),
  pot_id: z.string().uuid(),
});

export const DeleteEntryResponseSchema = z.object({
  ok: z.boolean(),
});

// Types
export type CreateTextEntryRequest = z.infer<typeof CreateTextEntryRequestSchema>;
export type ListEntriesQuery = z.infer<typeof ListEntriesQuerySchema>;
export type EntryResponse = z.infer<typeof EntryResponseSchema>;
export type EntryListResponse = z.infer<typeof EntryListResponseSchema>;
export type DeleteEntryResponse = z.infer<typeof DeleteEntryResponseSchema>;
