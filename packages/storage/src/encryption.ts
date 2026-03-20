/**
 * Asset encryption module using AES-256-GCM
 *
 * Blob format: [version: 1 byte][nonce: 12 bytes][ciphertext: variable][tag: 16 bytes]
 *
 * Key: 32-byte AES-256 key from ENCRYPTION_KEY env var
 * Nonce: Random 12-byte IV (unique per encryption)
 * AEAD: GCM provides authenticated encryption (confidentiality + integrity)
 */

import crypto from 'node:crypto';
import { getConfig } from '@links/config';

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12; // 96 bits (recommended for GCM)
const TAG_LENGTH = 16; // 128 bits (GCM auth tag)
const VERSION = 1; // Encryption version for future key rotation

let encryptionKeyCache: Buffer | null = null;

/**
 * Get encryption key from config, cached for performance
 */
export function getEncryptionKey(): Buffer {
  if (!encryptionKeyCache) {
    const config = getConfig();
    const keyHex = config.ENCRYPTION_KEY;

    // Validate hex format (64 chars = 32 bytes)
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }

    encryptionKeyCache = Buffer.from(keyHex, 'hex');
  }

  return encryptionKeyCache;
}

/**
 * Clear cached key (useful for tests or key rotation)
 */
export function clearEncryptionKeyCache(): void {
  encryptionKeyCache = null;
}

/**
 * Encrypt plaintext buffer to blob format
 *
 * @param plaintext - Raw bytes to encrypt
 * @returns Encrypted blob: [version][nonce][ciphertext][tag]
 */
export function encryptBlob(plaintext: Buffer): Buffer {
  const key = getEncryptionKey();
  const nonce = crypto.randomBytes(NONCE_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });

  // Encrypt
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  // Get auth tag
  const tag = cipher.getAuthTag();

  // Assemble blob: [version: 1][nonce: 12][ciphertext: N][tag: 16]
  return Buffer.concat([
    Buffer.from([VERSION]),
    nonce,
    ciphertext,
    tag,
  ]);
}

/**
 * Decrypt blob format to plaintext buffer
 *
 * @param blob - Encrypted blob: [version][nonce][ciphertext][tag]
 * @returns Decrypted plaintext
 * @throws Error if blob is malformed or auth tag verification fails (tamper detection)
 */
export function decryptBlob(blob: Buffer): Buffer {
  const key = getEncryptionKey();

  // Validate minimum size: 1 (version) + 12 (nonce) + 16 (tag) = 29 bytes
  if (blob.length < 29) {
    throw new Error('Blob too small: corrupted or invalid format');
  }

  // Parse blob structure
  const version = blob[0]!;
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version} (expected ${VERSION})`);
  }

  const nonce = blob.subarray(1, 13); // bytes 1-12
  const ciphertext = blob.subarray(13, -TAG_LENGTH); // middle section
  const tag = blob.subarray(-TAG_LENGTH); // last 16 bytes

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });

  // Set auth tag for verification
  decipher.setAuthTag(tag);

  try {
    // Decrypt and verify
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(), // Throws if auth tag verification fails
    ]);
  } catch (error) {
    // GCM auth tag verification failed = tamper detection
    throw new Error('Decryption failed: blob tampered or corrupted', {
      cause: error,
    });
  }
}

/**
 * Parse blob header without decrypting (for metadata inspection)
 *
 * @param blob - Encrypted blob
 * @returns Header metadata
 */
export function parseBlobHeader(blob: Buffer): { version: number; nonce: Buffer } {
  if (blob.length < 29) {
    throw new Error('Blob too small: corrupted or invalid format');
  }

  return {
    version: blob[0]!,
    nonce: blob.subarray(1, 13),
  };
}

/**
 * Calculate overhead size (version + nonce + tag)
 */
export function getEncryptionOverhead(): number {
  return 1 + NONCE_LENGTH + TAG_LENGTH; // 29 bytes
}
