/**
 * Phase 9: Bundle Manifest Builder
 *
 * Creates manifests with stable SHA-256 hashes for all bundled files.
 * Guarantees consistent hashing for tamper detection.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Manifest, ManifestEntry } from './bundleTypes.js';

/**
 * Compute SHA-256 hash of file contents
 *
 * @param data - File contents as Buffer or string
 * @returns SHA-256 hex digest (64 chars)
 */
export function hashData(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute SHA-256 hash of file at path
 *
 * @param filePath - Absolute file path
 * @returns SHA-256 hex digest
 */
export async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return hashData(data);
}

/**
 * Create manifest entry for a file
 *
 * @param relPath - Relative path in bundle (e.g., 'data/entries.json')
 * @param data - File contents
 * @returns ManifestEntry with hash and size
 */
export function createManifestEntry(
  relPath: string,
  data: Buffer | string
): ManifestEntry {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

  return {
    path: relPath,
    sha256: hashData(buffer),
    size_bytes: buffer.length,
  };
}

/**
 * Build complete manifest
 *
 * @param params - Manifest parameters
 * @returns Complete Manifest object
 */
export function buildManifest(params: {
  pot_id: string;
  pot_name: string;
  export_mode: 'private' | 'public';
  counts: {
    entries: number;
    assets: number;
    artifacts: number;
    links: number;
    audit_events: number;
  };
  entries: ManifestEntry[];
}): Manifest {
  return {
    version: 1,
    created_at: Date.now(),
    pot_id: params.pot_id,
    pot_name: params.pot_name,
    export_mode: params.export_mode,
    counts: params.counts,
    schema_versions: {
      pot: 1,
      entries: 1,
      assets: 1,
      artifacts: 1,
      links: 1,
      audit_events: 1,
    },
    files: params.entries,
  };
}

/**
 * Verify manifest hashes
 *
 * Given a mapping of file paths to data, verify all hashes in manifest match.
 * Returns success or array of mismatched files.
 *
 * @param manifest - Manifest to verify
 * @param fileData - Map of relative path -> file contents
 * @returns { ok: true } or { ok: false, mismatches: string[] }
 */
export function verifyManifestHashes(
  manifest: Manifest,
  fileData: Map<string, Buffer | string>
): { ok: true } | { ok: false; mismatches: string[] } {
  const mismatches: string[] = [];

  for (const entry of manifest.files) {
    const data = fileData.get(entry.path);
    if (!data) {
      mismatches.push(`${entry.path} (missing from bundle)`);
      continue;
    }

    const actualHash = hashData(data);
    if (actualHash !== entry.sha256) {
      mismatches.push(
        `${entry.path} (expected ${entry.sha256}, got ${actualHash})`
      );
    }
  }

  if (mismatches.length > 0) {
    return { ok: false, mismatches };
  }

  return { ok: true };
}
