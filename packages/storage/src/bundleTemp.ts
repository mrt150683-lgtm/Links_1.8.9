/**
 * Phase 9: Bundle Temp Directory Manager
 *
 * Creates and cleans up temp directories for bundle export/import.
 * Guarantees cleanup even on failure (try/finally, signal handlers).
 * No decrypted data should persist on disk.
 */

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Global cleanup registry for signal handlers
 */
const cleanupPaths = new Set<string>();

/**
 * Register signal handlers for guaranteed cleanup
 */
function registerSignalHandlers(): void {
  if (cleanupPaths.size === 0) {
    // Only register once
    const cleanup = () => {
      for (const path of cleanupPaths) {
        try {
          // Synchronous cleanup on signal
          const fs = require('fs');
          fs.rmSync(path, { recursive: true, force: true });
        } catch {
          // Ignore errors during signal cleanup
        }
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGHUP', cleanup);
  }
}

/**
 * Create a temp directory for bundle operations
 *
 * @param prefix - Optional prefix for directory name (default 'lynxpot-')
 * @returns Absolute path to temp directory
 */
export async function createTempDir(prefix = 'lynxpot-'): Promise<string> {
  registerSignalHandlers();

  const tempPath = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.add(tempPath);

  return tempPath;
}

/**
 * Clean up temp directory
 *
 * Recursively removes all files and the directory itself.
 * Deregisters from cleanup set. No-op if directory doesn't exist.
 *
 * @param dirPath - Absolute path to temp directory
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  cleanupPaths.delete(dirPath);
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a subdirectory in temp directory
 *
 * @param parentPath - Parent temp directory
 * @param subdir - Subdirectory name (e.g., 'assets', 'data')
 * @returns Absolute path to subdirectory
 */
export async function ensureTempSubdir(
  parentPath: string,
  subdir: string
): Promise<string> {
  const fullPath = join(parentPath, subdir);
  await mkdir(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Execute a function with guaranteed temp dir cleanup
 *
 * Usage:
 *   const result = await withTempDir(async (tmpDir) => {
 *     // Write files to tmpDir
 *     // Even if error thrown, tmpDir is cleaned up
 *     return result;
 *   });
 *
 * @param callback - Async function receiving temp dir path
 * @returns Result from callback
 */
export async function withTempDir<T>(
  callback: (tmpDir: string) => Promise<T>
): Promise<T> {
  const tmpDir = await createTempDir();

  try {
    return await callback(tmpDir);
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
