import { z } from 'zod';

/**
 * License payload - the core data that gets signed
 */
export const LicensePayloadSchema = z.object({
  schema: z.literal(1),
  kid: z.string().min(1),
  product: z.literal('links'),
  license_id: z.string().uuid(),
  issued_at: z.number().int().positive(),
  expires_at: z.union([z.number().int().positive(), z.null()]),
  tier: z.enum(['basic', 'pro', 'ultra']),
  fingerprint_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  customer_ref: z.string().optional(),
});

export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

/**
 * Stored license - payload + signature
 */
export const StoredLicenseSchema = z.object({
  payload: LicensePayloadSchema,
  signature: z.string().regex(/^[a-f0-9]+$/),
  kid: z.string().min(1),
});

export type StoredLicense = z.infer<typeof StoredLicenseSchema>;

/**
 * License request - sent to vendor for signing
 */
export const LicenseRequestSchema = z.object({
  schema: z.literal(1),
  product: z.literal('links'),
  request_id: z.string().uuid(),
  created_at: z.number().int().positive(),
  fingerprint_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  app_version: z.string().min(1),
});

export type LicenseRequest = z.infer<typeof LicenseRequestSchema>;

/**
 * License validation result - what the app gets back from validation
 */
export interface LicenseValidationResult {
  valid: boolean;
  reason?:
    | 'dev_mode'
    | 'no_license'
    | 'bad_signature'
    | 'expired'
    | 'wrong_machine'
    | 'invalid_product'
    | 'parse_error';
  tier?: 'basic' | 'pro' | 'ultra';
  expiresAt?: number | null;
}
