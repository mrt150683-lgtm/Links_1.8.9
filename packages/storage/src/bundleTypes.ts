/**
 * Phase 9: Bundle types (internal storage module)
 *
 * Defines manifest and exported record types for bundles.
 * These are storage-layer types, not re-exported from @links/core.
 */

/**
 * File entry in manifest with hash
 */
export interface ManifestEntry {
  path: string;
  sha256: string;
  size_bytes: number;
}

/**
 * Bundle manifest: includes file hashes and schema versions
 */
export interface Manifest {
  version: 1;
  created_at: number;
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
  schema_versions: {
    pot: number;
    entries: number;
    assets: number;
    artifacts: number;
    links: number;
    audit_events: number;
  };
  files: ManifestEntry[];
}
