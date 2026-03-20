/**
 * Phase 9: Bundle Encryption Module
 *
 * Provides AEAD encryption with Argon2id KDF:
 * - XChaCha20-Poly1305 for 256-bit keys
 * - Argon2id for secure key derivation from passphrases
 * - Random nonce per encryption (24 bytes for XChaCha20)
 * - Tamper detection via Poly1305 auth tag
 *
 * Uses @noble/ciphers + @noble/hashes (pure JS, ESM-native, no native build required)
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { argon2id } from '@noble/hashes/argon2';
import { randomBytes } from '@noble/hashes/utils';

// Constants matching libsodium's moderate Argon2id defaults
const SECRETBOX_KEYBYTES = 32; // 256-bit key
const SECRETBOX_NONCEBYTES = 24; // XChaCha20 nonce
const PWHASH_SALTBYTES = 16; // Argon2 salt
const PWHASH_OPSLIMIT_MODERATE = 3; // t = 3 iterations
const PWHASH_MEMLIMIT_MODERATE = 67108864; // 64 MB in bytes → 65536 KB

/**
 * KDF parameters for Argon2id
 */
export interface KdfParams {
  salt: string; // Base64-encoded salt
  ops_limit: number; // Argon2id ops_limit (iterations)
  mem_limit: number; // Argon2id mem_limit in bytes
}

/**
 * Generate secure random KDF parameters
 */
export async function generateKdfParams(): Promise<KdfParams> {
  const salt = randomBytes(PWHASH_SALTBYTES);
  return {
    salt: Buffer.from(salt).toString('base64'),
    ops_limit: PWHASH_OPSLIMIT_MODERATE,
    mem_limit: PWHASH_MEMLIMIT_MODERATE,
  };
}

/**
 * Derive encryption key from passphrase using Argon2id
 *
 * @param passphrase - User passphrase (never logged)
 * @param params - KDF parameters
 * @returns 32-byte key suitable for XChaCha20-Poly1305
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  params: KdfParams
): Promise<Buffer> {
  const salt = Buffer.from(params.salt, 'base64');
  const key = argon2id(passphrase, salt, {
    t: params.ops_limit,
    m: params.mem_limit / 1024, // noble takes KB, libsodium stored bytes
    p: 1,
    dkLen: SECRETBOX_KEYBYTES,
  });
  return Buffer.from(key);
}

/**
 * Encrypt plaintext with XChaCha20-Poly1305
 *
 * Returns buffer: [nonce (24 bytes) | ciphertext | tag (16 bytes)]
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte encryption key
 * @returns Encrypted blob with nonce prepended
 */
export async function encryptBundleBlob(plaintext: Buffer, key: Buffer): Promise<Buffer> {
  if (key.length !== SECRETBOX_KEYBYTES) {
    throw new Error('Key must be 32 bytes');
  }

  const nonce = randomBytes(SECRETBOX_NONCEBYTES);
  const chacha = xchacha20poly1305(key, nonce);
  const ciphertext = chacha.encrypt(plaintext);

  // Return: nonce + ciphertext (includes 16-byte Poly1305 tag)
  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
}

/**
 * Decrypt blob with XChaCha20-Poly1305
 *
 * Blob format: [nonce (24 bytes) | ciphertext | tag (16 bytes)]
 *
 * @param blob - Encrypted blob with nonce prepended
 * @param key - 32-byte decryption key
 * @returns Decrypted plaintext
 * @throws Error if tag verification fails (tamper detected)
 */
export async function decryptBundleBlob(blob: Buffer, key: Buffer): Promise<Buffer> {
  if (key.length !== SECRETBOX_KEYBYTES) {
    throw new Error('Key must be 32 bytes');
  }

  if (blob.length < SECRETBOX_NONCEBYTES) {
    throw new Error('Blob too short to contain nonce');
  }

  const nonce = blob.subarray(0, SECRETBOX_NONCEBYTES);
  const ciphertext = blob.subarray(SECRETBOX_NONCEBYTES);

  try {
    const chacha = xchacha20poly1305(key, nonce);
    const plaintext = chacha.decrypt(ciphertext);
    return Buffer.from(plaintext);
  } catch {
    // Tag verification failed - indicates tampering or wrong key
    throw new Error('Decryption failed: authentication tag verification failed (bundle may be tampered)');
  }
}

/**
 * Encrypt with automatic KDF + key derivation
 *
 * @param plaintext - Data to encrypt
 * @param passphrase - User passphrase
 * @param params - KDF parameters (returned for header)
 * @returns { blob: encrypted data, params: KDF parameters }
 */
export async function encryptWithPassphrase(
  plaintext: Buffer,
  passphrase: string,
  params?: KdfParams
): Promise<{ blob: Buffer; params: KdfParams }> {
  const kdfParams = params || await generateKdfParams();
  const key = await deriveKeyFromPassphrase(passphrase, kdfParams);
  const blob = await encryptBundleBlob(plaintext, key);
  return { blob, params: kdfParams };
}

/**
 * Decrypt with automatic KDF + key derivation
 *
 * @param blob - Encrypted blob (with nonce prepended)
 * @param passphrase - User passphrase
 * @param params - KDF parameters from header
 * @returns Decrypted plaintext
 * @throws Error if passphrase wrong or blob tampered
 */
export async function decryptWithPassphrase(
  blob: Buffer,
  passphrase: string,
  params: KdfParams
): Promise<Buffer> {
  const key = await deriveKeyFromPassphrase(passphrase, params);
  return await decryptBundleBlob(blob, key);
}
