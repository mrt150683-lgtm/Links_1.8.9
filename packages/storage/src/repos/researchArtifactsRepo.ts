/**
 * Research Artifacts Repository
 *
 * Manages run-scoped AI artifacts for the deep research agent:
 * research_plan, research_report, research_delta, research_novelty, research_checkpoint
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { ResearchArtifact, CreateResearchArtifactInput, ResearchArtifactType } from '../types.js';

function toArtifact(row: any): ResearchArtifact {
  return {
    id: row.id,
    run_id: row.run_id,
    artifact_type: row.artifact_type,
    schema_version: row.schema_version,
    model_id: row.model_id ?? null,
    prompt_id: row.prompt_id ?? null,
    prompt_version: row.prompt_version ?? null,
    temperature: row.temperature ?? null,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
  };
}

/**
 * Create a new research artifact
 */
export async function createResearchArtifact(
  input: CreateResearchArtifactInput
): Promise<ResearchArtifact> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('research_artifacts')
    .values({
      id,
      run_id: input.run_id,
      artifact_type: input.artifact_type,
      schema_version: input.schema_version ?? 1,
      model_id: input.model_id ?? null,
      prompt_id: input.prompt_id ?? null,
      prompt_version: input.prompt_version ?? null,
      temperature: input.temperature ?? null,
      payload_json: JSON.stringify(input.payload),
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('research_artifacts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toArtifact(row);
}

/**
 * Upsert a research artifact of a given type for a run.
 * Uses INSERT OR REPLACE semantics — always writes the latest version.
 */
export async function upsertResearchArtifact(
  input: CreateResearchArtifactInput
): Promise<ResearchArtifact> {
  const db = getDatabase();
  const now = Date.now();

  // Check if one exists to reuse the ID
  const existing = await db
    .selectFrom('research_artifacts')
    .select('id')
    .where('run_id', '=', input.run_id)
    .where('artifact_type', '=', input.artifact_type)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (existing) {
    // Update in-place to preserve the ID (which may be referenced by research_runs FK columns)
    await db
      .updateTable('research_artifacts')
      .set({
        schema_version: input.schema_version ?? 1,
        model_id: input.model_id ?? null,
        prompt_id: input.prompt_id ?? null,
        prompt_version: input.prompt_version ?? null,
        temperature: input.temperature ?? null,
        payload_json: JSON.stringify(input.payload),
      })
      .where('id', '=', existing.id)
      .execute();

    const row = await db
      .selectFrom('research_artifacts')
      .selectAll()
      .where('id', '=', existing.id)
      .executeTakeFirstOrThrow();

    return toArtifact(row);
  }

  const id = randomUUID();

  await db
    .insertInto('research_artifacts')
    .values({
      id,
      run_id: input.run_id,
      artifact_type: input.artifact_type,
      schema_version: input.schema_version ?? 1,
      model_id: input.model_id ?? null,
      prompt_id: input.prompt_id ?? null,
      prompt_version: input.prompt_version ?? null,
      temperature: input.temperature ?? null,
      payload_json: JSON.stringify(input.payload),
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('research_artifacts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return toArtifact(row);
}

/**
 * Get the latest artifact of a given type for a run
 */
export async function getResearchArtifact(
  runId: string,
  type: ResearchArtifactType
): Promise<ResearchArtifact | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('research_artifacts')
    .selectAll()
    .where('run_id', '=', runId)
    .where('artifact_type', '=', type)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? toArtifact(row) : null;
}

/**
 * Get artifact by ID
 */
export async function getResearchArtifactById(id: string): Promise<ResearchArtifact | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('research_artifacts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? toArtifact(row) : null;
}
