/**
 * Deep Research Executor (v2 — Two-Phase Model)
 *
 * Phase A (Constraints): Shallow scan of pot corpus to extract domain
 *   definitions, constraints, and foundational knowledge. No web augmentation.
 *   Capped at max_constraint_learnings.
 *
 * Phase B (Research): Full-depth research loop.
 *   - If web_augmentation_enabled: uses the Search Escalator (yield-aware,
 *     batched, with URL triage + hard-fail gate).
 *   - If corpus-only: existing depth loop, unchanged.
 *
 * Quality gates:
 * - filterWithTracking / validateAndFilterLearnings: drops evidence-less learnings
 * - topicGuard: drops off-topic research learnings
 * - Hard-fail gate (web path): returns blocked artifact if min thresholds not met
 *
 * Supports checkpoint/resume and budget hard stops.
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import {
  AiQueryGenerationResponseSchema,
  AiLearningExtractionResponseSchema,
  AiReportSynthesisResponseSchema,
} from '@links/core';
import type {
  Learning,
  ResearchReportArtifact,
  BudgetUsage,
  ResearchBlockedArtifact,
  RejectionSummary,
} from '@links/core';
import { createLogger } from '@links/logging';
import { BudgetGuard, BudgetExceededError } from './budget.js';
import { saveCheckpoint, type CheckpointSaveInput } from './checkpoint.js';
import { getPromptsDir } from './promptsDir.js';
import { validateAndFilterLearnings, recencyFilter, hasRecentCitation } from './learningFilter.js';
import { topicGuard } from './topicGuard.js';
import { RejectionTracker } from './rejectionTracker.js';
import { runEscalator } from './escalator.js';
import type {
  ResearchContext,
  ResearchState,
  DepthFrame,
  CorpusResult,
  EscalatorState,
  EscalatorStopReason,
} from './types.js';

const logger = createLogger({ name: 'deep-research:execute' });

// Stop words for topic keyword derivation
const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','had','her','was','one',
  'our','out','are','has','his','how','its','may','new','now','old','see','way',
  'who','did','get','let','say','she','too','use','with','that','this','will',
  'each','from','have','been','more','when','what','some','them','than','into',
  'only','very','just','about','also','over','such','after','most','many',
  'should','would','could','these','other','which','their','there','where',
  'being','does','were','they','your','make','like','then','been','find',
  'research','using','based','must','include','provide','information',
]);

export interface ExecuteOptions {
  model: string;
  resume?: {
    checkpoint: Record<string, unknown> | null;
    checkpointArtifactId: string | null;
  };
}

export interface ExecuteResult {
  report?: ResearchReportArtifact;       // undefined when blocked
  blocked?: ResearchBlockedArtifact;     // present when blocked
  stopReason?: EscalatorStopReason;
  rejectionSummary?: RejectionSummary;
  budgetHit: boolean;
  finalBudgetUsage: BudgetUsage;
  entriesRead: Array<{ id: string; sha256: string }>;
  sourcesIngested: Array<{ url: string; sha256: string; entry_id: string }>;
  insufficiencyReason?: string;
}

/**
 * Execute the two-phase deep research loop for a run.
 */
export async function executeDeepResearch(
  ctx: ResearchContext,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const PROMPTS_DIR = getPromptsDir();
  const { model } = opts;

  // Load prompts
  const queryGenPrompt = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'query_generation', 'v1.md'));
  const learningPromptV2 = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'learning_extraction', 'v2.md'));
  const reportPromptV2 = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'report_synthesis', 'v2.md'));

  const budget = new BudgetGuard(ctx.config.budget);
  const requireEvidence = ctx.config.require_evidence_for_learnings ?? true;

  // Escalator state — restored from checkpoint if available
  let escalatorState: EscalatorState = { batchIndex: 0, lowYieldCount: 0, candidatesTotal: 0, sourcesTotal: 0, stage: 0 };
  const tracker = new RejectionTracker();

  // Load checkpoint or start fresh
  let state: ResearchState;
  if (opts.resume) {
    const restored = await import('./checkpoint.js').then((m) =>
      m.loadCheckpoint(opts.resume!.checkpoint, opts.resume!.checkpointArtifactId)
    );
    if (restored) {
      logger.info({ run_id: ctx.runId, phase: restored.currentPhase, msg: 'Resuming from checkpoint' });
      state = {
        learnings: restored.state.accumulatedLearnings,
        visited_entry_ids: restored.state.visitedEntryIds,
        visited_urls: restored.state.visitedUrls,
        entries_read: restored.state.entriesReadFull,
        sources_ingested: [],
        depth_stack: restored.state.depthStack,
        budget_usage: restored.budgetUsage,
        started_at: restored.startedAt,
        current_phase: restored.currentPhase,
        constraint_learnings_count: restored.constraintLearningsCount,
        topic_keywords: restored.topicKeywords,
      };
      escalatorState = {
        batchIndex: restored.escalatorBatchIndex,
        lowYieldCount: restored.escalatorLowYieldCount,
        candidatesTotal: restored.escalatorCandidatesTotal,
        sourcesTotal: restored.escalatorSourcesTotal,
        stage: restored.escalatorStage,
      };
      tracker.restore(restored.rejectionSummary, restored.sourceExtractionRecords);
    } else {
      logger.info({ run_id: ctx.runId, msg: 'No valid checkpoint — starting fresh' });
      state = initState();
    }
  } else {
    state = initState();
  }

  let budgetHit = false;

  // Helper: build the save-checkpoint callback
  const doSaveCheckpoint = async (escalator?: EscalatorState, t?: RejectionTracker) => {
    const input: CheckpointSaveInput = {
      runId: ctx.runId,
      potId: ctx.potId,
      state: {
        depth_stack: state.depth_stack,
        visited_entry_ids: Array.from(state.visited_entry_ids),
        visited_urls: Array.from(state.visited_urls),
        learnings: state.learnings,
        entries_read: state.entries_read,
      },
      budgetUsage: budget.getCurrentUsage(),
      startedAt: state.started_at,
      currentPhase: state.current_phase,
      constraintLearningsCount: state.constraint_learnings_count,
      topicKeywords: state.topic_keywords,
      ...(escalator && {
        escalatorBatchIndex: escalator.batchIndex,
        escalatorLowYieldCount: escalator.lowYieldCount,
        escalatorCandidatesTotal: escalator.candidatesTotal,
        escalatorSourcesTotal: escalator.sourcesTotal,
        escalatorStage: escalator.stage,
      }),
      ...(t && {
        sourceExtractionRecords: t.getSourceRecords(),
        rejectionSummary: t.getSummary(),
      }),
    };
    await saveCheckpoint(input);
  };

  try {
    // ─── PHASE A: CONSTRAINTS ───
    if (state.current_phase === 'constraint') {
      logger.info({ run_id: ctx.runId, msg: 'Phase A: Extracting constraints from corpus' });

      await ctx.progress?.update({
        phase: 'retrieving',
        message: 'Phase A: Extracting domain constraints',
        current_depth: 0,
        total_depth: 1,
        current_breadth: 0,
        total_breadth: ctx.config.budget.max_breadth,
        queries_completed: 0,
        queries_total: 0,
        entries_read: state.entries_read.length,
        learnings_count: state.learnings.length,
        pages_fetched: 0,
      }, budget.getCurrentUsage());

      // Generate corpus-focused queries if starting fresh
      if (state.depth_stack.length === 0) {
        const initialQueries = await generateQueries(
          ctx.goalPrompt, state.learnings, model, queryGenPrompt, budget
        );
        state.depth_stack = [{ depth: 0, pending_queries: initialQueries, completed_queries: [] }];
      }

      // Phase A loop: shallow (max_depth=1), corpus-only, no web
      const maxConstraints = ctx.config.max_constraint_learnings ?? 10;

      while (state.depth_stack.length > 0 && state.constraint_learnings_count < maxConstraints) {
        const frame = state.depth_stack[state.depth_stack.length - 1]!;

        if (frame.pending_queries.length === 0) { state.depth_stack.pop(); continue; }
        if (frame.depth >= 1) { state.depth_stack = []; break; }

        const query = frame.pending_queries.shift()!;
        frame.completed_queries.push(query);

        logger.info({ run_id: ctx.runId, depth: frame.depth, query, phase: 'constraint', msg: 'Processing constraint query' });

        await ctx.progress?.update({
          phase: 'retrieving',
          message: 'Phase A: Extracting domain constraints',
          current_depth: frame.depth,
          total_depth: 1,
          current_query: query,
          entries_read: state.entries_read.length,
          learnings_count: state.learnings.length,
          queries_completed: countCompletedQueries(state.depth_stack),
          queries_total: countTotalQueries(state.depth_stack),
          current_breadth: frame.completed_queries.length,
          total_breadth: ctx.config.budget.max_breadth,
          pages_fetched: state.sources_ingested.length,
        }, budget.getCurrentUsage());

        budget.check();

        const results = await ctx.corpus.search(query, ctx.config.budget.max_breadth);
        const newResults = results.filter((r) => !state.visited_entry_ids.has(r.entry_id));

        for (const r of newResults) {
          state.visited_entry_ids.add(r.entry_id);
          if (!state.entries_read.find((e) => e.id === r.entry_id)) {
            state.entries_read.push({ id: r.entry_id, sha256: r.sha256 });
          }
        }

        budget.record({ entries_read: newResults.length });

        if (newResults.length > 0) {
          budget.check();
          let newLearnings = await extractLearnings(
            ctx.goalPrompt, query, newResults, model, learningPromptV2, budget, 'constraint'
          );
          newLearnings = validateAndFilterLearnings(newLearnings, ctx.runId, requireEvidence, 'constraint');

          const remaining = maxConstraints - state.constraint_learnings_count;
          if (newLearnings.length > remaining) newLearnings = newLearnings.slice(0, remaining);

          state.learnings.push(...newLearnings);
          state.constraint_learnings_count += newLearnings.length;
        }

        await doSaveCheckpoint();
      }

      // Derive topic keywords from goal + constraint learnings
      state.topic_keywords = ctx.config.topic_keywords ?? deriveTopicKeywords(
        ctx.goalPrompt,
        state.learnings.filter((l) => l.kind === 'constraint')
      );

      // Transition to Phase B
      state.current_phase = 'research';
      state.depth_stack = [];

      logger.info({
        run_id: ctx.runId,
        constraint_count: state.constraint_learnings_count,
        topic_keywords: state.topic_keywords.slice(0, 10),
        msg: 'Phase A complete, transitioning to Phase B',
      });

      await ctx.progress?.update({
        phase: 'processing',
        message: 'Transitioning to research phase',
        entries_read: state.entries_read.length,
        learnings_count: state.learnings.length,
        current_depth: 0,
        total_depth: ctx.config.budget.max_depth,
        queries_completed: 0,
        queries_total: 0,
        current_breadth: 0,
        total_breadth: ctx.config.budget.max_breadth,
        pages_fetched: state.sources_ingested.length,
      }, budget.getCurrentUsage());

      await doSaveCheckpoint();
    }

    // ─── PHASE B: RESEARCH ───
    if (state.current_phase === 'research') {
      logger.info({ run_id: ctx.runId, msg: 'Phase B: Full-depth research' });

      if (ctx.config.web_augmentation_enabled && ctx.ingestor) {
        // ── ESCALATOR PATH ─────────────────────────────────────────────────
        const saveEscalatorCheckpoint = (
          s: ResearchState,
          es: EscalatorState,
          b: BudgetGuard,
          t: RejectionTracker
        ) => {
          void b; // budget state is captured via closure
          return doSaveCheckpoint(es, t);
        };

        const escalatorResult = await runEscalator(
          ctx, state, escalatorState, tracker, budget, model, saveEscalatorCheckpoint
        );

        if (escalatorResult.stopReason === 'BUDGET') budgetHit = true;

        // ── HARD-FAIL GATE ─────────────────────────────────────────────────
        // Only block when the escalator genuinely exhausted its options AND
        // there were actually URLs to work with. If the pot has no
        // discoverable external URLs, the escalator can't be expected to
        // find web sources — fall through to report synthesis instead.
        const escalCfg = ctx.config.escalator;
        const minExternal = escalCfg.min_external_sources;
        const targetCandidates = escalCfg.target_candidates;

        const researchLearnings = state.learnings.filter((l) => l.kind === 'research');
        const sourcesTotal = escalatorResult.sourcesIngested.length;
        const rejSummaryCheck = escalatorResult.rejectionSummary;

        // When no URLs were even discovered in the corpus (nothing triaged,
        // nothing ingested), the pot simply lacks external references.
        // This is a corpus limitation, not a quality failure.
        const noUrlsDiscovered = sourcesTotal === 0
          && rejSummaryCheck.total_urls_triaged === 0;

        const shouldBlock = !budgetHit
          && !noUrlsDiscovered
          && (escalatorResult.stopReason === 'DIMINISHING_RETURNS' || escalatorResult.stopReason === 'HARD_CEILING')
          && (sourcesTotal < minExternal || researchLearnings.length < targetCandidates);

        if (noUrlsDiscovered && (escalatorResult.stopReason === 'DIMINISHING_RETURNS' || escalatorResult.stopReason === 'HARD_CEILING')) {
          logger.info({
            run_id: ctx.runId,
            research_learnings: researchLearnings.length,
            stop_reason: escalatorResult.stopReason,
            msg: 'No external URLs found in corpus — skipping hard-fail gate, proceeding to report',
          });
        }

        if (shouldBlock) {
          const insufficientSources = sourcesTotal < minExternal;
          const insufficientCandidates = researchLearnings.length < targetCandidates;
          const reason = insufficientSources && insufficientCandidates
            ? 'BOTH'
            : insufficientSources
              ? 'INSUFFICIENT_SOURCES'
              : 'INSUFFICIENT_CANDIDATES';

          const rejSummary = escalatorResult.rejectionSummary;
          const triagedCount = rejSummary.triage_rejected_low_relevance + rejSummary.triage_rejected_not_recent;
          const candidates2023plus = researchLearnings.filter(hasRecentCitation).length;

          const blockedArtifact: ResearchBlockedArtifact = {
            reason,
            sources_fetched: sourcesTotal,
            triage_rejected_count: triagedCount,
            candidates_count: researchLearnings.length,
            candidates_2023plus: candidates2023plus,
            target_candidates: targetCandidates,
            min_external_sources: minExternal,
            top_rejection_reasons: tracker.getTopRejectionReasons(5),
            rejection_summary: rejSummary,
            source_records: escalatorResult.sourceRecords,
            generated_at: Date.now(),
          };

          logger.warn({
            run_id: ctx.runId,
            reason,
            sources_total: sourcesTotal,
            candidates_count: researchLearnings.length,
            msg: 'Hard-fail gate triggered — run blocked',
          });

          return {
            blocked: blockedArtifact,
            stopReason: escalatorResult.stopReason,
            rejectionSummary: rejSummary,
            budgetHit: false,
            finalBudgetUsage: budget.getCurrentUsage(),
            entriesRead: state.entries_read,
            sourcesIngested: state.sources_ingested,
          };
        }

      } else {
        // ── CORPUS-ONLY PATH ───────────────────────────────────────────────
        await runCorpusOnlyLoop(ctx, state, budget, model, queryGenPrompt, learningPromptV2, requireEvidence, doSaveCheckpoint);
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      logger.warn({ run_id: ctx.runId, violations: err.violations, msg: 'Budget exceeded — writing partial report' });
      budgetHit = true;
    } else {
      throw err;
    }
  }

  // External quota diagnostic (non-blocking, for report note only — hard gate above already returned if needed)
  const insufficiencyReason = ctx.config.web_augmentation_enabled
    ? checkExternalQuotaDiagnostic(ctx, state)
    : undefined;

  // Synthesize report
  await ctx.progress?.update({ phase: 'synthesizing' }, budget.getCurrentUsage());

  const report = await synthesizeReport(
    ctx.goalPrompt,
    state.learnings,
    state.entries_read,
    state.sources_ingested,
    budgetHit,
    model,
    reportPromptV2,
    budget,
    insufficiencyReason
  );

  return {
    report,
    budgetHit,
    finalBudgetUsage: budget.getCurrentUsage(),
    entriesRead: state.entries_read,
    sourcesIngested: state.sources_ingested,
    insufficiencyReason,
  };
}

// ============================================================================
// Corpus-Only Phase B Loop (unchanged from original Phase B depth loop)
// ============================================================================

async function runCorpusOnlyLoop(
  ctx: ResearchContext,
  state: ResearchState,
  budget: BudgetGuard,
  model: string,
  queryGenPrompt: ReturnType<typeof loadPromptFromFile>,
  learningPromptV2: ReturnType<typeof loadPromptFromFile>,
  requireEvidence: boolean,
  doSaveCheckpoint: () => Promise<void>
): Promise<void> {
  if (state.depth_stack.length === 0) {
    const constraintSummary = state.learnings.filter((l) => l.kind === 'constraint').slice(-10);
    const initialQueries = await generateQueries(ctx.goalPrompt, constraintSummary, model, queryGenPrompt, budget);
    state.depth_stack = [{ depth: 0, pending_queries: initialQueries, completed_queries: [] }];
  }

  while (state.depth_stack.length > 0) {
    const frame = state.depth_stack[state.depth_stack.length - 1]!;

    if (frame.pending_queries.length === 0) { state.depth_stack.pop(); continue; }
    if (frame.depth >= ctx.config.budget.max_depth) { state.depth_stack = []; break; }

    const query = frame.pending_queries.shift()!;
    frame.completed_queries.push(query);

    logger.info({ run_id: ctx.runId, depth: frame.depth, query, phase: 'research', msg: 'Processing research query (corpus-only)' });

    await ctx.progress?.update({
      phase: 'retrieving',
      message: 'Phase B: Researching (corpus-only)',
      current_depth: frame.depth,
      total_depth: ctx.config.budget.max_depth,
      current_query: query,
      entries_read: state.entries_read.length,
      learnings_count: state.learnings.length,
      queries_completed: countCompletedQueries(state.depth_stack),
      queries_total: countTotalQueries(state.depth_stack),
      current_breadth: frame.completed_queries.length,
      total_breadth: ctx.config.budget.max_breadth,
      pages_fetched: state.sources_ingested.length,
    }, budget.getCurrentUsage());

    budget.check();

    const results = await ctx.corpus.search(query, ctx.config.budget.max_breadth);
    const newResults = results.filter((r) => !state.visited_entry_ids.has(r.entry_id));

    for (const r of newResults) {
      state.visited_entry_ids.add(r.entry_id);
      if (!state.entries_read.find((e) => e.id === r.entry_id)) {
        state.entries_read.push({ id: r.entry_id, sha256: r.sha256 });
      }
    }

    budget.record({ entries_read: newResults.length });

    if (newResults.length > 0) {
      budget.check();

      let newLearnings = await extractLearnings(
        ctx.goalPrompt, query, newResults, model, learningPromptV2, budget, 'research'
      );

      newLearnings = validateAndFilterLearnings(newLearnings, ctx.runId, requireEvidence, 'research');
      newLearnings = topicGuard(
        newLearnings, state.topic_keywords, ctx.config.topic_guard_enabled ?? true, ctx.runId
      );
      // Recency gate only for web path — corpus-only runs won't have 2023+ dates
      // so the gate would drop everything legitimately found.

      state.learnings.push(...newLearnings);

      if (frame.depth + 1 < ctx.config.budget.max_depth && newLearnings.length > 0) {
        const followUpQueries = await generateQueries(
          ctx.goalPrompt, state.learnings.slice(-20), model, queryGenPrompt, budget
        );
        state.depth_stack.push({
          depth: frame.depth + 1,
          pending_queries: followUpQueries.slice(0, ctx.config.budget.max_breadth),
          completed_queries: [],
        });
      }
    }

    await doSaveCheckpoint();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function initState(): ResearchState {
  return {
    learnings: [],
    visited_entry_ids: new Set(),
    visited_urls: new Set(),
    entries_read: [],
    sources_ingested: [],
    depth_stack: [],
    budget_usage: { wall_time_ms: 0, model_tokens: 0, cost_cents: 0, entries_read: 0, web_pages_fetched: 0, total_sources: 0 },
    started_at: Date.now(),
    current_phase: 'constraint',
    constraint_learnings_count: 0,
    topic_keywords: [],
  };
}

function countCompletedQueries(stack: DepthFrame[]): number {
  return stack.reduce((sum, f) => sum + f.completed_queries.length, 0);
}

function countTotalQueries(stack: DepthFrame[]): number {
  return stack.reduce((sum, f) => sum + f.pending_queries.length + f.completed_queries.length, 0);
}

function deriveTopicKeywords(goalPrompt: string, constraintLearnings: Learning[]): string[] {
  const goalWords = goalPrompt.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const constraintWords = constraintLearnings.map((l) => l.text).join(' ').toLowerCase().match(/[a-z]{4,}/g) ?? [];

  const freq = new Map<string, number>();

  for (const word of goalWords) {
    if (STOP_WORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 5);
  }
  for (const word of constraintWords) {
    if (STOP_WORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
}

function classifyByRecency(learnings: Learning[]): { baseline: Learning[]; emerging: Learning[] } {
  const baseline: Learning[] = [];
  const emerging: Learning[] = [];
  for (const l of learnings) {
    if (hasRecentCitation(l)) emerging.push(l);
    else baseline.push(l);
  }
  return { baseline, emerging };
}

/**
 * Soft diagnostic (non-blocking) — generates an insufficiency note for the report.
 * The hard-fail gate (which returns early with blocked artifact) runs before this.
 */
function checkExternalQuotaDiagnostic(
  ctx: ResearchContext,
  state: ResearchState
): string | undefined {
  const minExternal = ctx.config.min_external_sources ?? 0;
  if (minExternal === 0) return undefined;

  const reasons: string[] = [];
  if (state.sources_ingested.length < minExternal) {
    reasons.push(`Only ${state.sources_ingested.length} external sources ingested (minimum: ${minExternal})`);
  }
  const researchLearnings = state.learnings.filter((l) => l.kind === 'research');
  if (researchLearnings.length < 3) {
    reasons.push(`Only ${researchLearnings.length} research learnings (minimum: 3)`);
  }

  if (reasons.length === 0) return undefined;

  const reason = reasons.join('; ');
  logger.warn({ run_id: ctx.runId, reason, msg: 'External quota not fully met (report note)' });
  return reason;
}

async function generateQueries(
  goalPrompt: string,
  currentLearnings: Learning[],
  model: string,
  prompt: ReturnType<typeof loadPromptFromFile>,
  budget: BudgetGuard
): Promise<string[]> {
  const learningsSummary = currentLearnings
    .slice(-10)
    .map((l) => `- ${l.text}`)
    .join('\n');

  const messages = interpolatePrompt(prompt, {
    goal_prompt: goalPrompt,
    current_learnings: learningsSummary || 'None yet.',
  });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.3,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const usage = response.usage;
  if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

  try {
    const parsed = JSON.parse(raw.trim());
    const result = AiQueryGenerationResponseSchema.parse(parsed);
    return result.queries;
  } catch {
    logger.warn({ msg: 'Query generation returned invalid JSON, using goal as query' });
    return [goalPrompt.substring(0, 200)];
  }
}

async function extractLearnings(
  goalPrompt: string,
  query: string,
  results: CorpusResult[],
  model: string,
  prompt: ReturnType<typeof loadPromptFromFile>,
  budget: BudgetGuard,
  phase: 'constraint' | 'research'
): Promise<Learning[]> {
  const corpus = results
    .map((r) => `[entry:${r.entry_id}] ${r.source_label}\n${r.content}`)
    .join('\n\n---\n\n');

  const ifConstraint = phase === 'constraint'
    ? 'Extract facts, definitions, and domain constraints from internal documents. Each source must be of type `pot` with `entry_id` and `excerpt` from the snippet. Focus on foundational knowledge that defines the research domain.'
    : '';
  const ifResearch = phase === 'research'
    ? 'Extract findings and insights. Sources from internal docs should use type `pot`. Sources from external/web content should use type `web` with a URL. Focus on novel findings relevant to the research goal.'
    : '';

  const messages = interpolatePrompt(prompt, {
    goal_prompt: goalPrompt,
    query,
    corpus_snippets: corpus.substring(0, 8000),
    learning_kind: phase,
    '#if_constraint': ifConstraint,
    '/if_constraint': '',
    '#if_research': ifResearch,
    '/if_research': '',
  });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const usage = response.usage;
  if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

  try {
    const parsed = JSON.parse(raw.trim());
    const result = AiLearningExtractionResponseSchema.parse(parsed);
    for (const learning of result.learnings) {
      if (!learning.kind || learning.kind !== phase) {
        (learning as { kind: string }).kind = phase;
      }
    }
    return result.learnings;
  } catch {
    logger.warn({ query, phase, msg: 'Learning extraction returned invalid JSON' });
    return [];
  }
}

async function synthesizeReport(
  goalPrompt: string,
  learnings: Learning[],
  entriesRead: Array<{ id: string; sha256: string }>,
  sourcesIngested: Array<{ url: string; sha256: string; entry_id: string }>,
  budgetHit: boolean,
  model: string,
  prompt: ReturnType<typeof loadPromptFromFile>,
  budget: BudgetGuard,
  insufficiencyReason: string | undefined
): Promise<ResearchReportArtifact> {
  const constraintLearnings = learnings.filter((l) => l.kind === 'constraint');
  const researchLearnings = learnings.filter((l) => l.kind !== 'constraint');

  const topConstraints = constraintLearnings.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 15);
  const topResearch = researchLearnings.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 30);

  const constraintSummary = topConstraints
    .map((l, i) => `${i + 1}. [confidence: ${l.confidence.toFixed(2)}] ${l.text}`)
    .join('\n');
  const researchSummary = topResearch
    .map((l, i) => `${i + 1}. [confidence: ${l.confidence.toFixed(2)}] ${l.text}`)
    .join('\n');

  const ifInsufficiency = insufficiencyReason
    ? `NOTE: This report has insufficient external coverage. The limitation is: ${insufficiencyReason}\nInclude this limitation prominently in the summary and as an open question.`
    : '';

  const { baseline, emerging } = classifyByRecency(topResearch);

  const baselineSummary = baseline.length > 0
    ? baseline.slice(0, 5).map((l, i) => `${i + 1}. [confidence: ${l.confidence.toFixed(2)}] ${l.text}`).join('\n')
    : 'None identified.';
  const emergingSummary = emerging.length > 0
    ? emerging.slice(0, 15).map((l, i) => `${i + 1}. [confidence: ${l.confidence.toFixed(2)}] ${l.text}`).join('\n')
    : 'None identified.';

  const messages = interpolatePrompt(prompt, {
    goal_prompt: goalPrompt,
    constraint_learnings: constraintSummary || 'No constraint learnings extracted.',
    research_learnings: researchSummary || 'No research learnings found.',
    baseline_techniques: baselineSummary,
    emerging_techniques: emergingSummary,
    pot_entries_read: String(entriesRead.length),
    external_sources_count: String(sourcesIngested.length),
    entries_read_count: String(entriesRead.length),
    sources_count: String(sourcesIngested.length),
    budget_hit: budgetHit ? 'yes (partial results)' : 'no',
    insufficiency_reason: insufficiencyReason ?? '',
    '#if_insufficiency': ifInsufficiency,
    '/if_insufficiency': '',
  });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.3,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const usage = response.usage;
  if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

  try {
    const parsed = JSON.parse(raw.trim());
    const result = AiReportSynthesisResponseSchema.parse(parsed);
    return {
      ...result,
      learnings,
      budget_hit: budgetHit,
      entries_read_count: entriesRead.length,
      sources_count: sourcesIngested.length,
      insufficiency_reason: insufficiencyReason,
      entries_read_full: entriesRead,
      sources_ingested_full: sourcesIngested,
      generated_at: Date.now(),
    };
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), msg: 'Report synthesis failed, writing fallback' });

    const allSummary = [...topConstraints, ...topResearch]
      .map((l, i) => `${i + 1}. [confidence: ${l.confidence.toFixed(2)}] ${l.text}`)
      .join('\n');

    return {
      title: `Research Report: ${goalPrompt.substring(0, 80)}`,
      summary: 'Report synthesis failed. Learnings collected below.',
      sections: [{ heading: 'Collected Learnings', content: allSummary }],
      learnings,
      open_loops: ['Full synthesis failed due to AI error'],
      budget_hit: budgetHit,
      entries_read_count: entriesRead.length,
      sources_count: sourcesIngested.length,
      insufficiency_reason: insufficiencyReason,
      entries_read_full: entriesRead,
      sources_ingested_full: sourcesIngested,
      generated_at: Date.now(),
    };
  }
}
