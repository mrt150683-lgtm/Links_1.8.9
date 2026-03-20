/**
 * Phase 8: Link Discovery Types
 *
 * TypeScript types for link discovery API requests and responses
 */

import type { LinkType, LinkEvidence } from './link-schemas.js';

/**
 * Link response (for API)
 */
export interface LinkResponse {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  link_type: LinkType;
  confidence: number;
  rationale: string;
  evidence: LinkEvidence[];
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  temperature: number;
  created_at: number;
}

/**
 * List links response for entry
 */
export interface ListEntryLinksResponse {
  entry_id: string;
  links: Array<{
    link_id: string;
    link_type: LinkType;
    confidence: number;
    rationale: string;
    other_entry_id: string;
    evidence: LinkEvidence[];
    created_at: number;
  }>;
}

/**
 * List links response for pot
 */
export interface ListPotLinksResponse {
  pot_id: string;
  links: LinkResponse[];
  total_count: number;
}

/**
 * Manual link discovery trigger request
 */
export interface TriggerLinkDiscoveryRequest {
  max_candidates?: number; // default 30
  force?: boolean; // default false, skip if already processed recently
}

/**
 * Manual link discovery trigger response
 */
export interface TriggerLinkDiscoveryResponse {
  entry_id: string;
  candidates_generated: number;
  jobs_enqueued: number;
  message: string;
}

/**
 * Link candidate response (for debugging/admin)
 */
export interface LinkCandidateResponse {
  id: string;
  pot_id: string;
  src_entry_id: string;
  dst_entry_id: string;
  reason: string;
  score: number;
  status: 'new' | 'processing' | 'processed' | 'skipped';
  created_at: number;
}
