/**
 * Phase 7: Derived Artifacts Repository
 *
 * Manages AI-generated derived artifacts (tags, entities, summaries)
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { DerivedArtifact, CreateArtifactInput } from '../types.js';

/**
 * Insert or update artifact
 *
 * Uses UNIQUE constraint on (entry_id, artifact_type, prompt_id, prompt_version)
 * to implement deterministic reprocessing: same inputs => same artifact row
 *
 * @param input - Artifact data to insert/update
 * @param force - If true, use INSERT OR REPLACE; if false, skip if exists
 * @returns Created/updated artifact, or null if skipped
 */
export async function insertArtifact(
  input: CreateArtifactInput,
  force: boolean = false
): Promise<DerivedArtifact | null> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  const schema_version = input.schema_version ?? 1;
  const payload_json = JSON.stringify(input.payload);
  const evidence_json = input.evidence ? JSON.stringify(input.evidence) : null;

  if (!force) {
    // Check if artifact already exists for this entry + type + prompt version + role
    // If role_hash differs, treat as "not exists" so the artifact is regenerated with new role.
    let existsQuery = db
      .selectFrom('derived_artifacts')
      .selectAll()
      .where('entry_id', '=', input.entry_id)
      .where('artifact_type', '=', input.artifact_type)
      .where('prompt_id', '=', input.prompt_id)
      .where('prompt_version', '=', input.prompt_version);

    const roleHash = input.role_hash ?? null;
    if (roleHash !== null) {
      existsQuery = existsQuery.where('role_hash', '=', roleHash);
    } else {
      existsQuery = existsQuery.where('role_hash', 'is', null);
    }

    const existing = await existsQuery.executeTakeFirst();

    if (existing) {
      // Artifact exists with same role, skip insert
      return null;
    }
  }

  const role_hash = input.role_hash ?? null;

  // Insert or replace (deterministic upsert)
  // SQLite doesn't have a direct UPSERT with RETURNING, so we use INSERT OR REPLACE
  await db
    .insertInto('derived_artifacts')
    .values({
      id,
      pot_id: input.pot_id,
      entry_id: input.entry_id,
      artifact_type: input.artifact_type,
      schema_version,
      model_id: input.model_id,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      temperature: input.temperature,
      max_tokens: input.max_tokens ?? null,
      created_at: now,
      payload_json,
      evidence_json,
      role_hash,
    })
    .onConflict((oc) =>
      oc.columns(['entry_id', 'artifact_type', 'prompt_id', 'prompt_version']).doUpdateSet({
        id, // Update ID to track latest insert
        model_id: input.model_id,
        temperature: input.temperature,
        max_tokens: input.max_tokens ?? null,
        // Note: created_at is not updated (readonly after insert)
        payload_json,
        evidence_json,
        role_hash, // Update role provenance when role changes
      })
    )
    .execute();

  // Fetch the inserted/updated artifact
  const artifact = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('entry_id', '=', input.entry_id)
    .where('artifact_type', '=', input.artifact_type)
    .where('prompt_id', '=', input.prompt_id)
    .where('prompt_version', '=', input.prompt_version)
    .executeTakeFirstOrThrow();

  return toDomainArtifact(artifact);
}

/**
 * List all artifacts for an entry
 */
export async function listArtifactsForEntry(entryId: string): Promise<DerivedArtifact[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('entry_id', '=', entryId)
    .orderBy('artifact_type', 'asc')
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(toDomainArtifact);
}

/**
 * Get latest artifact of a specific type for an entry
 */
export async function getLatestArtifact(
  entryId: string,
  type: 'tags' | 'entities' | 'summary' | 'extracted_text'
): Promise<DerivedArtifact | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('entry_id', '=', entryId)
    .where('artifact_type', '=', type)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? toDomainArtifact(row) : null;
}

/**
 * Check if artifact exists for specific entry + type + prompt version + role
 */
export async function artifactExists(
  entryId: string,
  type: 'tags' | 'entities' | 'summary' | 'extracted_text',
  promptId: string,
  promptVersion: string,
  roleHash?: string | null
): Promise<boolean> {
  const db = getDatabase();
  let query = db
    .selectFrom('derived_artifacts')
    .select('id')
    .where('entry_id', '=', entryId)
    .where('artifact_type', '=', type)
    .where('prompt_id', '=', promptId)
    .where('prompt_version', '=', promptVersion);

  if (roleHash !== undefined) {
    if (roleHash !== null) {
      query = query.where('role_hash', '=', roleHash);
    } else {
      query = query.where('role_hash', 'is', null);
    }
  }

  const row = await query.executeTakeFirst();
  return row !== undefined;
}

/**
 * List all artifacts for a pot (across all entries)
 */
export async function listArtifactsForPot(potId: string): Promise<DerivedArtifact[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(toDomainArtifact);
}

/**
 * List artifacts for a pot filtered by artifact types.
 * More efficient than listArtifactsForPot when only specific types are needed.
 * @param potId - Pot ID
 * @param types - Array of artifact types to include (e.g. ['tags', 'entities', 'summary'])
 */
export async function listArtifactsByPot(potId: string, types: string[]): Promise<DerivedArtifact[]> {
  const db = getDatabase();
  let query = db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc');

  if (types.length > 0) {
    query = query.where('artifact_type', 'in', types as any);
  }

  const rows = await query.execute();
  return rows.map(toDomainArtifact);
}

/**
 * Delete all artifacts for an entry
 * (Normally handled by CASCADE DELETE, but can be called explicitly)
 */
export async function deleteArtifactsForEntry(entryId: string): Promise<number> {
  const db = getDatabase();
  const result = await db
    .deleteFrom('derived_artifacts')
    .where('entry_id', '=', entryId)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

/**
 * Convert database row to domain object
 */
function toDomainArtifact(row: any): DerivedArtifact {
  return {
    id: row.id,
    pot_id: row.pot_id,
    entry_id: row.entry_id,
    artifact_type: row.artifact_type,
    schema_version: row.schema_version,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    created_at: row.created_at,
    payload: JSON.parse(row.payload_json),
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
    role_hash: row.role_hash ?? null,
  };
}
