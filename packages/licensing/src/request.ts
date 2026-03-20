import { randomUUID } from 'crypto';
import { computeFingerprintSync } from './fingerprint.js';
import type { LicenseRequest } from './schemas.js';

/**
 * Generate a license request
 * This is sent to the vendor to get a signed license
 *
 * The request is not security-critical (no secrets),
 * it's just "please sign this fingerprint"
 */
export function generateLicenseRequest(appVersion: string): LicenseRequest {
  return {
    schema: 1,
    product: 'links',
    request_id: randomUUID(),
    created_at: Date.now(),
    fingerprint_sha256: computeFingerprintSync(),
    app_version: appVersion,
  };
}
