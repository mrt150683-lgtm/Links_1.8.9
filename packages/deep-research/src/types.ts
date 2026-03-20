/**
 * Deep Research Agent - Core Interfaces
 *
 * Adapter interfaces injected at runtime. These allow the core research
 * logic to remain decoupled from storage and HTTP fetch implementations.
 */

import type { Learning, BudgetUsage, ResearchBudget, ResearchRunConfig } from '@links/core';

// ============================================================================
// Adapters (interfaces injected at runtime)
// ============================================================================

export interface CorpusResult {
  entry_id: string;
  content: string;        // snippet: summary (up to 600 chars) + content_text (up to 2000 chars)
  source_label: string;   // entry.source_url ?? "entry:<id>"
  sha256: string;         // entry.content_sha256
}

export interface CorpusProvider {
  search(query: string, topK: number): Promise<CorpusResult[]>;
}

export interface SourceIngestor {
  ingest(url: string, title: string, fetchedContent: string): Promise<{ id: string; content_sha256: string }>;
}

export interface ProgressReporter {
  update(progress: Record<string, unknown>, budgetUsage?: Record<string, unknown>): Promise<void>;
}

// ============================================================================
// Research Execution Context
// ============================================================================

export interface ResearchContext {
  runId: string;
  potId: string;
  goalPrompt: string;
  config: ResearchRunConfig;
  corpus: CorpusProvider;
  ingestor?: SourceIngestor;
  progress?: ProgressReporter;
}

// ============================================================================
// Intermediate Types
// ============================================================================

export interface DepthFrame {
  depth: number;
  pending_queries: string[];
  completed_queries: string[];
}

export interface ResearchState {
  learnings: Learning[];
  visited_entry_ids: Set<string>;
  visited_urls: Set<string>;
  entries_read: Array<{ id: string; sha256: string }>;
  sources_ingested: Array<{ url: string; sha256: string; entry_id: string }>;
  depth_stack: DepthFrame[];
  budget_usage: BudgetUsage;
  started_at: number;
  current_phase: 'constraint' | 'research';
  constraint_learnings_count: number;
  topic_keywords: string[];
}

export interface QueryResult {
  query: string;
  corpus_results: CorpusResult[];
  learnings: Learning[];
  follow_up_queries: string[];
}

// ============================================================================
// Link Candidate (for auto-linking)
// ============================================================================

export interface LinkCandidate {
  src_entry_id: string;
  dst_entry_id: string;
  reason: string;
  confidence: number;
  has_evidence_excerpts: boolean;
}
