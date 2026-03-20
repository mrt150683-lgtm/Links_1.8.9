/**
 * Asset store: File I/O for encrypted binary blobs
 *
 * Storage layout: ${ASSETS_DIR}/<sha256>.blob
 * All files are encrypted at rest using AES-256-GCM
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getConfig } from '@links/config';
import { encryptBlob, decryptBlob } from './encryption.js';

let assetsDir: string = '';

/**
 * Get assets directory from config, cached for performance
 */
export function getAssetsDir(): string {
  if (!assetsDir) {
    const config = getConfig();
    assetsDir = config.ASSETS_DIR;
  }
  return assetsDir;
}

/**
 * Clear cached assets directory (useful for tests)
 */
export function clearAssetsDirCache(): void {
  assetsDir = '';
}

/**
 * Initialize asset store (create directory if not exists)
 */
export async function initAssetStore(): Promise<void> {
  const dir = getAssetsDir();

  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 }); // Owner read/write/execute only
  }
}

/**
 * Compute storage path for a given sha256 hash
 *
 * @param sha256 - Content hash (hex string)
 * @returns Absolute path to blob file
 */
export function getAssetPath(sha256: string): string {
  // Validate sha256 format (64 hex chars)
  if (!/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error('Invalid sha256 format');
  }

  const dir = getAssetsDir();
  return path.join(dir, `${sha256}.blob`);
}

/**
 * Write encrypted asset blob to disk (atomic operation)
 *
 * Uses temp file + rename for atomicity to prevent corruption on crash
 *
 * @param sha256 - Content hash (for path computation)
 * @param plainBytes - Raw unencrypted bytes to store
 * @returns Storage path (relative to ASSETS_DIR)
 */
export async function writeEncryptedAsset(
  sha256: string,
  plainBytes: Buffer,
): Promise<string> {
  await initAssetStore();

  const targetPath = getAssetPath(sha256);
  const tempPath = `${targetPath}.tmp`;

  try {
    // Encrypt
    const encryptedBlob = encryptBlob(plainBytes);

    // Write to temp file
    await fs.writeFile(tempPath, encryptedBlob, { mode: 0o600 }); // Owner read/write only

    // fsync not directly available in fs/promises, but write is durable enough
    // for our use case (SQLite transaction provides coordination)

    // Atomic rename (overwrites if target exists on POSIX)
    await fs.rename(tempPath, targetPath);

    // Return relative path for storage in DB
    return path.relative(getAssetsDir(), targetPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error('Failed to write encrypted asset', { cause: error });
  }
}

/**
 * Read and decrypt asset blob from disk
 *
 * @param storagePath - Path returned by writeEncryptedAsset (relative or absolute)
 * @returns Decrypted plaintext bytes
 * @throws Error if file not found or decryption fails (tamper detection)
 */
export async function readDecryptedAsset(storagePath: string): Promise<Buffer> {
  // Handle both relative and absolute paths
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(getAssetsDir(), storagePath);

  try {
    const encryptedBlob = await fs.readFile(absolutePath);
    return decryptBlob(encryptedBlob);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Asset not found: ${storagePath}`, { cause: error });
    }
    throw new Error('Failed to read or decrypt asset', { cause: error });
  }
}

/**
 * Delete asset blob file from disk
 *
 * Does not throw if file doesn't exist (idempotent)
 *
 * @param storagePath - Path returned by writeEncryptedAsset
 */
export async function deleteAssetFile(storagePath: string): Promise<void> {
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(getAssetsDir(), storagePath);

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Already deleted, idempotent
      return;
    }
    throw new Error('Failed to delete asset', { cause: error });
  }
}

/**
 * Check if asset blob exists on disk
 *
 * @param storagePath - Path to check
 * @returns True if file exists
 */
export async function assetExists(storagePath: string): Promise<boolean> {
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(getAssetsDir(), storagePath);

  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
