/**
 * Phase 9: Bundle Format Schemas
 *
 * Strict Zod validation for encrypted pot bundles:
 * - Bundle header (unencrypted metadata)
 * - Manifest (file hashes, versions)
 * - Exported records (pot, entries, assets, artifacts, links, audit)
 */

import { z } from 'zod';

/**
 * Bundle header (unencrypted, prepended to bundle)
 * Contains KDF parameters and encryption metadata
 */
export const BundleHeaderSchema = z.object({
  format_version: z.literal(1).describe('Bundle format version'),
  cipher: z.enum(['xchacha20-poly1305', 'aes-256-gcm']).describe('Encryption cipher'),
  kdf: z.enum(['argon2id']).describe('Key derivation function'),
  kdf_params: z.object({
    salt: z.string().min(32).max(128).describe('Base64-encoded salt'),
    ops_limit: z.number().int().positive().describe('Argon2id ops_limit'),
    mem_limit: z.number().int().positive().describe('Argon2id mem_limit (bytes)'),
  }),
  nonce: z.string().min(32).max(64).describe('Base64-encoded nonce'),
  encrypted_payload_length: z.number().int().positive().describe('Length of encrypted payload in bytes'),
  export_mode: z.enum(['private', 'public']).describe('Export visibility mode'),
  created_at: z.number().int().describe('Unix timestamp'),
  app_version: z.string().regex(/^\d+\.\d+\.\d+/).describe('Links app version'),
});

export type BundleHeader = z.infer<typeof BundleHeaderSchema>;

/**
 * Manifest entry (one per file in bundle)
 */
export const ManifestEntrySchema = z.object({
  path: z.string().describe('Relative path in bundle'),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/).describe('SHA-256 hex digest'),
  size_bytes: z.number().int().nonnegative().describe('File size in bytes'),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * Manifest (includes schema versions for all exported tables)
 */
export const ManifestSchema = z.object({
  version: z.literal(1).describe('Manifest version'),
  created_at: z.number().int().describe('Creation timestamp'),
  pot_id: z.string().uuid().describe('Original pot ID'),
  pot_name: z.string().min(1).describe('Pot name'),
  export_mode: z.enum(['private', 'public']).describe('Export mode'),
  counts: z.object({
    entries: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    audit_events: z.number().int().nonnegative(),
  }),
  schema_versions: z.object({
    pot: z.number().int().positive().describe('Pot table schema version'),
    entries: z.number().int().positive().describe('Entries table schema version'),
    assets: z.number().int().positive().describe('Assets table schema version'),
    artifacts: z.number().int().positive().describe('Artifacts table schema version'),
    links: z.number().int().positive().describe('Links table schema version'),
    audit_events: z.number().int().positive().describe('Audit events table schema version'),
  }),
  files: z.array(ManifestEntrySchema).describe('List of bundled files with hashes'),
});

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Exported pot record
 */
export const ExportedPotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  security_level: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  last_used_at: z.number().int().nullable(),
});

export type ExportedPot = z.infer<typeof ExportedPotSchema>;

/**
 * Exported entry record
 */
export const ExportedEntrySchema = z.object({
  id: z.string().uuid(),
  pot_id: z.string().uuid(),
  type: z.enum(['text', 'image', 'doc']),
  content_text: z.string().nullable(),
  content_sha256: z.string().nullable(),
  capture_method: z.string(),
  source_url: z.string().nullable(),
  source_title: z.string().nullable(),
  notes: z.string().nullable(),
  captured_at: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  client_capture_id: z.string().nullable(),
  source_app: z.string().nullable(),
  source_context_json: z.string().nullable(),
  asset_id: z.string().uuid().nullable(),
});

export type ExportedEntry = z.infer<typeof ExportedEntrySchema>;

/**
 * Exported asset record
 */
export const ExportedAssetSchema = z.object({
  id: z.string().uuid(),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  size_bytes: z.number().int().positive(),
  mime_type: z.string(),
  original_filename: z.string().nullable(),
  storage_path: z.string(),
  encryption_version: z.number().int().positive(),
  created_at: z.number().int(),
});

export type ExportedAsset = z.infer<typeof ExportedAssetSchema>;

/**
 * Exported artifact record
 */
export const ExportedArtifactSchema = z.object({
  id: z.string().uuid(),
  pot_id: z.string().uuid(),
  entry_id: z.string().uuid(),
  artifact_type: z.enum(['tags', 'entities', 'summary']),
  schema_version: z.number().int().positive(),
  model_id: z.string(),
  prompt_id: z.string(),
  prompt_version: z.string(),
  temperature: z.number(),
  max_tokens: z.number().int().nullable(),
  created_at: z.number().int(),
  payload_json: z.string(),
  evidence_json: z.string().nullable(),
});

export type ExportedArtifact = z.infer<typeof ExportedArtifactSchema>;

/**
 * Exported link record
 */
export const ExportedLinkSchema = z.object({
  id: z.string().uuid(),
  pot_id: z.string().uuid(),
  src_entry_id: z.string().uuid(),
  dst_entry_id: z.string().uuid(),
  link_type: z.enum([
    'same_topic',
    'same_entity',
    'supports',
    'contradicts',
    'references',
    'sequence',
    'duplicate',
    'other',
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  evidence_json: z.string(),
  model_id: z.string(),
  prompt_id: z.string(),
  prompt_version: z.string(),
  temperature: z.number(),
  created_at: z.number().int(),
});

export type ExportedLink = z.infer<typeof ExportedLinkSchema>;

/**
 * Exported audit event record
 */
export const ExportedAuditEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number().int(),
  actor: z.enum(['user', 'system', 'extension']),
  action: z.string(),
  pot_id: z.string().uuid().nullable(),
  entry_id: z.string().uuid().nullable(),
  metadata_json: z.string(),
});

export type ExportedAuditEvent = z.infer<typeof ExportedAuditEventSchema>;

/**
 * Exported data container
 */
export const ExportedDataSchema = z.object({
  pot: ExportedPotSchema,
  entries: z.array(ExportedEntrySchema),
  assets: z.array(ExportedAssetSchema),
  artifacts: z.array(ExportedArtifactSchema),
  links: z.array(ExportedLinkSchema),
  audit_events: z.array(ExportedAuditEventSchema),
});

export type ExportedData = z.infer<typeof ExportedDataSchema>;

/**
 * Export options
 */
export const ExportOptionsSchema = z.object({
  mode: z.enum(['private', 'public']).default('private'),
  bundle_name: z.string().optional(),
  passphrase: z.string().min(8).describe('Passphrase must be at least 8 characters'),
  passphrase_hint: z.string().optional(),
});

export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

/**
 * Import options
 */
export const ImportOptionsSchema = z.object({
  bundle_path: z.string().describe('Absolute path to .lynxpot file'),
  passphrase: z.string(),
  import_as_name: z.string().optional().describe('Override pot name on import'),
});

export type ImportOptions = z.infer<typeof ImportOptionsSchema>;

/**
 * Export response
 */
export const ExportResponseSchema = z.object({
  ok: z.literal(true),
  bundle_path: z.string(),
  bundle_sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/),
});

export type ExportResponse = z.infer<typeof ExportResponseSchema>;

/**
 * Import response
 */
export const ImportResponseSchema = z.object({
  ok: z.literal(true),
  pot_id: z.string().uuid(),
  stats: z.object({
    entries: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
  }),
});

export type ImportResponse = z.infer<typeof ImportResponseSchema>;
