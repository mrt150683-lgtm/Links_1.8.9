/**
 * Phase 7: Derived Artifact Types
 *
 * TypeScript types for artifact API requests and responses
 */

import type { TagsArtifact, EntitiesArtifact, SummaryArtifact } from './artifact-schemas.js';

/**
 * Base artifact metadata (shared fields)
 * Note: Cannot import from @links/storage to avoid circular dependency
 */
export interface BaseArtifact {
  id: string;
  pot_id: string;
  entry_id: string;
  schema_version: number;
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  max_tokens: number | null;
  created_at: number;
}

/**
 * Artifact with typed payload
 */
export interface TagsArtifactResponse extends BaseArtifact {
  artifact_type: 'tags';
  payload: TagsArtifact;
  evidence: null;
}

export interface EntitiesArtifactResponse extends BaseArtifact {
  artifact_type: 'entities';
  payload: EntitiesArtifact;
  evidence: null;
}

export interface SummaryArtifactResponse extends BaseArtifact {
  artifact_type: 'summary';
  payload: SummaryArtifact;
  evidence: SummaryArtifact['claims'];
}

export type ArtifactResponse = TagsArtifactResponse | EntitiesArtifactResponse | SummaryArtifactResponse;

/**
 * List artifacts response
 */
export interface ListArtifactsResponse {
  entry_id: string;
  artifacts: ArtifactResponse[];
}

/**
 * Process entry request
 */
export interface ProcessEntryRequest {
  types: Array<'tags' | 'entities' | 'summary'>;
  force?: boolean;
}

/**
 * Process entry response
 */
export interface ProcessEntryResponse {
  entry_id: string;
  jobs: Array<{
    id: string;
    job_type: string;
    status: string;
  }>;
}
