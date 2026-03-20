/**
 * Phase 9: Public Mode Transform
 *
 * Strips sensitive fields from exported records when mode='public'.
 * Deterministic: same input always produces same output.
 * Tests validate field removal and ID preservation.
 */

// Using any for exported types to avoid circular dependency
// These are validated by core schemas on API boundaries
type ExportedPot = any;
type ExportedEntry = any;
type ExportedAuditEvent = any;

/**
 * Strip sensitive fields from pot record
 *
 * Fields removed in public mode: none (pot is already public)
 *
 * @param pot - Exported pot record
 * @returns Transformed pot record
 */
export function transformPotToPublic(pot: ExportedPot): ExportedPot {
  // Pot record has no sensitive fields to remove
  return { ...pot };
}

/**
 * Strip sensitive fields from entry record
 *
 * Fields removed in public mode:
 * - source_url
 * - source_title
 * - notes
 * - source_app
 * - source_context_json
 * - client_capture_id
 *
 * Preserved:
 * - id, pot_id, type, content_text, capture_method, captured_at
 * - asset_id (needed for asset linking)
 *
 * @param entry - Exported entry record
 * @returns Transformed entry with sensitive fields set to null
 */
export function transformEntryToPublic(entry: ExportedEntry): ExportedEntry {
  return {
    ...entry,
    source_url: null,
    source_title: null,
    notes: null,
    source_app: null,
    source_context_json: null,
    client_capture_id: null,
  };
}

/**
 * Strip sensitive fields from audit event record
 *
 * In public mode, audit events should be completely excluded.
 * If you need to include them, return null to indicate exclusion.
 *
 * @param _audit - Audit event record (ignored)
 * @returns null (indicating exclusion from public export)
 */
export function transformAuditToPublic(
  _audit: ExportedAuditEvent
): ExportedAuditEvent | null {
  // Return null to indicate this record should be excluded
  return null;
}

/**
 * Transform entire exported data set to public mode
 *
 * @param data - Exported data object
 * @returns Transformed data with sensitive fields removed/nullified
 */
export function transformExportedDataToPublic(data: any): any {
  return {
    pot: transformPotToPublic(data.pot),
    entries: data.entries.map((entry: any) => transformEntryToPublic(entry)),
    assets: data.assets, // Assets have no sensitive fields
    artifacts: data.artifacts, // Artifacts are derived, keep as-is
    links: data.links, // Links are derived, keep as-is
    audit_events: [], // Exclude all audit events in public mode
  };
}

/**
 * Validate that public transform removed expected fields
 *
 * Helper for testing: verify that transformation actually removes sensitive data
 *
 * @param originalEntry - Original entry record
 * @param publicEntry - Transformed entry record
 * @throws Error if sensitive fields still present
 */
export function validateEntryPublicTransform(
  originalEntry: ExportedEntry,
  publicEntry: ExportedEntry
): void {
  const sensitiveFields = [
    'source_url',
    'source_title',
    'notes',
    'source_app',
    'source_context_json',
    'client_capture_id',
  ] as const;

  for (const field of sensitiveFields) {
    if (publicEntry[field] !== null) {
      throw new Error(`Public entry still contains sensitive field: ${field}`);
    }
  }

  // IDs should be preserved
  if (publicEntry.id !== originalEntry.id) {
    throw new Error('Public transform changed entry ID');
  }
  if (publicEntry.pot_id !== originalEntry.pot_id) {
    throw new Error('Public transform changed pot ID');
  }
}
