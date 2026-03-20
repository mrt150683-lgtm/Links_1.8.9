import { createPublicKey, verify } from 'crypto';
import { computeFingerprintSync } from './fingerprint.js';
import { PUBLIC_KEYS } from './keys.js';
import {
  StoredLicenseSchema,
  LicensePayloadSchema,
  LicenseValidationResult,
} from './schemas.js';

/**
 * Deterministically stringifies an object by sorting its keys alphabetically.
 * Ensures the cryptographic payload string is identical across all environments.
 */
function stableStringify(obj: any): string {
  const allKeys: string[] = [];
  JSON.stringify(obj, (key, value) => {
    if (value !== undefined) allKeys.push(key);
    return value;
  });
  allKeys.sort();
  return JSON.stringify(obj, allKeys);
}

/**
 * Convert a raw 32-byte Ed25519 public key (hex) to a Node.js KeyObject
 */
function pubkeyFromRawHex(hex: string) {
  const rawBytes = Buffer.from(hex, 'hex');
  // Build SPKI DER: fixed 12-byte Ed25519 prefix + 32-byte raw key
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const spkiDer = Buffer.concat([spkiPrefix, rawBytes]);
  return createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
}

/**
 * Verify a stored license
 * Returns a LicenseValidationResult with detailed status
 */
export async function verifyLicense(stored: unknown): Promise<LicenseValidationResult> {
  try {
    // Parse and validate the license structure
    const parsed = StoredLicenseSchema.parse(stored);

    // Look up the public key by kid
    const pubkeyHex = PUBLIC_KEYS[parsed.kid];
    if (!pubkeyHex || pubkeyHex.includes('PLACEHOLDER')) {
      return {
        valid: false,
        reason: 'bad_signature',
      };
    }

    // Create canonical payload JSON and verify signature
    const canonicalPayload = stableStringify(parsed.payload);
    const signatureBytes = Buffer.from(parsed.signature, 'hex');
    const payloadBytes = Buffer.from(canonicalPayload!, 'utf-8');

    // Verify Ed25519 signature using Node.js crypto
    const pubKey = pubkeyFromRawHex(pubkeyHex);
    const isValid = verify(null, payloadBytes, pubKey, signatureBytes);
    if (!isValid) {
      return {
        valid: false,
        reason: 'bad_signature',
      };
    }

    // Validate payload content
    const payload = LicensePayloadSchema.parse(parsed.payload);

    // Check product
    if (payload.product !== 'links') {
      return {
        valid: false,
        reason: 'invalid_product',
      };
    }

    // Check expiry
    if (payload.expires_at !== null && Date.now() > payload.expires_at) {
      return {
        valid: true,
        reason: 'expired',
        tier: payload.tier,
        expiresAt: payload.expires_at,
      };
    }

    // Check machine fingerprint matches
    const currentFingerprint = computeFingerprintSync();
    if (payload.fingerprint_sha256 !== currentFingerprint) {
      return {
        valid: false,
        reason: 'wrong_machine',
      };
    }

    // License is valid
    return {
      valid: true,
      tier: payload.tier,
      expiresAt: payload.expires_at,
    };
  } catch (err) {
    return {
      valid: false,
      reason: 'parse_error',
    };
  }
}
