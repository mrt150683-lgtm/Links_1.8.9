/**
 * Links Licensing Package
 * Offline, Ed25519-signed license system
 */

import { readLicenseFile } from './storage.js';
import { verifyLicense } from './verify.js';

export * from './schemas.js';
export * from './fingerprint.js';
export * from './request.js';
export { readLicenseFile, writeLicenseFile } from './storage.js';

/**
 * Validate the license on startup.
 *
 * Licensing is disabled for the open-source release.
 * Always returns valid so the app runs without a license file.
 */
export async function validateLicense() {
  return { valid: true, reason: 'dev_mode' as const };
}
