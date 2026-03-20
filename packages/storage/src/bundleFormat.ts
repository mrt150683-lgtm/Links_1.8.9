/**
 * Phase 9: Bundle Format Handler
 *
 * Serializes/deserializes bundle header (unencrypted metadata).
 * Bundle file structure:
 *   [header_length: 4 bytes big-endian]
 *   [header_json: length bytes, UTF-8 encoded]
 *   [encrypted_payload: variable]
 */

// BundleHeader imported from @links/core via index.ts re-export
// For now, we just use any to avoid circular dependency
import type { BundleHeader } from '../../../packages/core/dist/index.js';

/**
 * Get app version for bundle header
 *
 * @returns Version string (e.g., "0.9.0")
 */
function getAppVersion(): string {
  // TODO: Load from config or package.json at runtime
  // For now, use a placeholder version
  return '0.9.0';
}

/**
 * Serialize bundle header to JSON bytes
 *
 * @param header - Bundle header object
 * @returns UTF-8 encoded JSON bytes
 */
export function serializeBundleHeader(header: BundleHeader): Buffer {
  const json = JSON.stringify(header);
  return Buffer.from(json, 'utf-8');
}

/**
 * Deserialize bundle header from JSON bytes
 *
 * @param headerBytes - UTF-8 encoded JSON bytes
 * @returns Parsed BundleHeader
 * @throws Error if JSON invalid
 */
export function deserializeBundleHeader(headerBytes: Buffer): BundleHeader {
  const json = headerBytes.toString('utf-8');
  return JSON.parse(json) as BundleHeader;
}

/**
 * Write header + payload to bundle file format
 *
 * Format:
 *   [header_length: 4 bytes, big-endian]
 *   [header_json: length bytes]
 *   [encrypted_payload: variable]
 *
 * @param header - Bundle header
 * @param payload - Encrypted payload bytes
 * @returns Complete bundle file bytes
 */
export function writeBundleFile(header: BundleHeader, payload: Buffer): Buffer {
  const headerBytes = serializeBundleHeader(header);

  // Write length as 4-byte big-endian uint32
  const lengthBuf = Buffer.allocUnsafe(4);
  lengthBuf.writeUInt32BE(headerBytes.length, 0);

  return Buffer.concat([lengthBuf, headerBytes, payload]);
}

/**
 * Read header + payload from bundle file format
 *
 * @param bundleBytes - Complete bundle file bytes
 * @returns { header, payload }
 * @throws Error if format invalid
 */
export function readBundleFile(bundleBytes: Buffer): { header: BundleHeader; payload: Buffer } {
  if (bundleBytes.length < 4) {
    throw new Error('Bundle file too short (cannot read header length)');
  }

  const headerLength = bundleBytes.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > 1024 * 1024) {
    // Sanity check: header should not exceed 1MB
    throw new Error(`Invalid header length: ${headerLength}`);
  }

  if (bundleBytes.length < 4 + headerLength) {
    throw new Error('Bundle file too short (cannot read full header)');
  }

  const headerBytes = bundleBytes.subarray(4, 4 + headerLength);
  const payload = bundleBytes.subarray(4 + headerLength);

  if (payload.length < 1) {
    throw new Error('Bundle file has no payload');
  }

  const header = deserializeBundleHeader(headerBytes);
  return { header, payload };
}

/**
 * Create a new bundle header with default values
 *
 * @param params - Partial header parameters
 * @returns Complete BundleHeader
 */
export function createBundleHeader(params: {
  cipher: 'xchacha20-poly1305' | 'aes-256-gcm';
  kdf_params: {
    salt: string;
    ops_limit: number;
    mem_limit: number;
  };
  nonce: string;
  encrypted_payload_length: number;
  export_mode: 'private' | 'public';
}): BundleHeader {
  return {
    format_version: 1,
    cipher: params.cipher,
    kdf: 'argon2id',
    kdf_params: params.kdf_params,
    nonce: params.nonce,
    encrypted_payload_length: params.encrypted_payload_length,
    export_mode: params.export_mode,
    created_at: Date.now(),
    app_version: getAppVersion(),
  };
}
