/**
 * Phase 4: Asset API schemas
 */

import { z } from 'zod';

/**
 * Asset response schema (metadata returned after upload)
 */
export const AssetResponseSchema = z.object({
  id: z.string().uuid(),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/i),
  size_bytes: z.number().int().positive(),
  mime_type: z.string(),
  original_filename: z.string().nullable(),
  storage_path: z.string(),
  encryption_version: z.number().int(),
  created_at: z.number().int().positive(),
});

/**
 * Upload response schema (includes deduplication info)
 */
export const AssetUploadResponseSchema = z.object({
  created: z.boolean(),
  asset: AssetResponseSchema,
  deduped: z.boolean(),
});

/**
 * Create image entry request schema
 */
export const CreateImageEntryRequestSchema = z.object({
  asset_id: z.string().uuid(),
  capture_method: z.string().min(1).max(50),
  source_url: z.string().url().optional(),
  source_title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  captured_at: z.number().int().positive().optional(),
  // Phase 3: idempotency (optional for Phase 4 MVP, can be added later)
  client_capture_id: z.string().max(128).optional(),
});

/**
 * Create doc entry request schema
 */
export const CreateDocEntryRequestSchema = z.object({
  asset_id: z.string().uuid(),
  capture_method: z.string().min(1).max(50),
  source_url: z.string().url().optional(),
  source_title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  captured_at: z.number().int().positive().optional(),
  // Phase 3: idempotency (optional for Phase 4 MVP, can be added later)
  client_capture_id: z.string().max(128).optional(),
});

/**
 * Create audio entry request schema
 * References an already-uploaded asset of type audio/*
 */
export const CreateAudioEntryRequestSchema = z.object({
  asset_id: z.string().uuid(),
  capture_method: z.string().min(1).max(50).default('upload'),
  source_url: z.string().url().optional(),
  source_title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  captured_at: z.number().int().positive().optional(),
  client_capture_id: z.string().max(128).optional(),
});

/**
 * Asset list response schema
 */
export const AssetListResponseSchema = z.object({
  assets: z.array(AssetResponseSchema),
  pot_id: z.string().uuid(),
});

// Type exports
export type AssetResponse = z.infer<typeof AssetResponseSchema>;
export type AssetUploadResponse = z.infer<typeof AssetUploadResponseSchema>;
export type CreateImageEntryRequest = z.infer<typeof CreateImageEntryRequestSchema>;
export type CreateDocEntryRequest = z.infer<typeof CreateDocEntryRequestSchema>;
export type CreateAudioEntryRequest = z.infer<typeof CreateAudioEntryRequestSchema>;
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;
