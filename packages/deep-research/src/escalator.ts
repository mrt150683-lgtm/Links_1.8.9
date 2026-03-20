/**
 * Search Escalator
 *
 * Replaces the naive "fetch first X sources" loop with a yield-aware batched
 * search process that escalates query complexity when yield drops.
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { AiLearningExtractionResponseSchema } from '@links/core';
import type { Learning, EscalatorConfig } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import { BudgetGuard, BudgetExceededError } from './budget.js';
import { RejectionTracker } from './rejectionTracker.js';
import { buildTriageCandidate, triageUrls } from './urlTriage.js';
import { generateEscalatedQueries } from './queryEscalation.js';
import { filterWithTracking } from './learningFilter.js';
import type { ResearchContext, ResearchState, EscalatorState, EscalatorResult, CorpusResult } from './types.js';

const logger = createLogger({ name: 'deep-research:escalator' });

interface SaveCheckpointFn {
    (state: ResearchState, escalatorState: EscalatorState, budget: BudgetGuard, tracker: RejectionTracker): Promise<void>;
}

export async function runEscalator(
    ctx: ResearchContext,
    state: ResearchState,
    escalatorState: EscalatorState,
    tracker: RejectionTracker,
    budget: BudgetGuard,
    model: string,
    saveCheckpointFn: SaveCheckpointFn
): Promise<EscalatorResult> {
    const config = ctx.config.escalator ?? ({} as EscalatorConfig);
    const targetCandidates = config.target_candidates ?? 10;
    const minExternalSources = config.min_external_sources ?? 12;
    const batchSize = config.batch_size ?? 6;
    const maxSourcesTotal = config.max_sources_total ?? 24;
    const minNewCandidatesPerBatch = config.min_new_candidates_per_batch ?? 2;
    const maxLowYieldBatches = config.max_low_yield_batches ?? 2;

    const PROMPTS_DIR = getPromptsDir();
    const learningPromptV2 = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'learning_extraction', 'v2.md'));

    const previousQueries = new Set<string>();
    for (const f of state.depth_stack) {
        for (const q of f.completed_queries) previousQueries.add(q);
    }

    // Deduplicate learnings
    const existingTexts = new Set<string>();
    for (const l of state.learnings) {
        existingTexts.add(l.text.trim().toLowerCase().substring(0, 200));
    }

    logger.info({
        run_id: ctx.runId,
        batch_index: escalatorState.batchIndex,
        stage: escalatorState.stage,
        candidates: escalatorState.candidatesTotal,
        sources: escalatorState.sourcesTotal,
        msg: 'Starting Escalator loop',
    });

    try {
        while (true) {
            budget.check();

            // 1. Generate queries
            const constraintLearnings = state.learnings.filter((l) => l.kind === 'constraint');
            const researchLearnings = state.learnings.filter((l) => l.kind === 'research');

            const queries = await generateEscalatedQueries(
                escalatorState.stage,
                ctx.goalPrompt,
                constraintLearnings,
                researchLearnings,
                state.topic_keywords,
                Array.from(previousQueries),
                model,
                budget
            );

            for (const q of queries) previousQueries.add(q);

            if (queries.length === 0) {
                // All queries deduped — treat as low yield and try to escalate
                if (escalatorState.stage < 3) {
                    escalatorState.stage++;
                    escalatorState.lowYieldCount = 0;
                    logger.info({ new_stage: escalatorState.stage, msg: 'No new queries after dedup — escalating stage' });
                    escalatorState.batchIndex++;
                    continue;
                }
                logger.warn({ msg: 'No queries generated at max stage, breaking escalator' });
                break;
            }

            await ctx.progress?.update({
                phase: 'retrieving',
                message: `Phase B: Searching (Stage ${escalatorState.stage})`,
                current_depth: escalatorState.stage,
                total_depth: 3,
                current_breadth: escalatorState.batchIndex,
                total_breadth: 10,
                entries_read: state.entries_read.length,
                learnings_count: state.learnings.length,
                pages_fetched: state.sources_ingested.length,
            }, budget.getCurrentUsage());

            // 2. Initial corpus search for URLs
            const allResults: CorpusResult[] = [];
            for (const q of queries) {
                const res = await ctx.corpus.search(q, ctx.config.budget.max_breadth);
                allResults.push(...res);
            }

            const newResults = allResults.filter((r) => !state.visited_entry_ids.has(r.entry_id));
            for (const r of newResults) {
                state.visited_entry_ids.add(r.entry_id);
                if (!state.entries_read.find((e) => e.id === r.entry_id)) {
                    state.entries_read.push({ id: r.entry_id, sha256: r.sha256 });
                }
            }

            budget.record({ entries_read: newResults.length });

            // 3. Extract learnings + candidate URLs from pot contents
            let batchYield = 0;
            const candidateUrs = new Map<string, { title: string; snippet: string }>();

            if (newResults.length > 0) {
                // Collect URLs from pot sources
                for (const res of newResults) {
                    if (res.source_label?.startsWith('http')) {
                        candidateUrs.set(res.source_label, { title: res.source_label, snippet: res.content });
                    }
                }

                const rawLearnings = await extractLearnings(
                    ctx.goalPrompt, queries.join(' | '), newResults, model, learningPromptV2, budget, 'research'
                );

                for (const l of rawLearnings) {
                    for (const url of l.source_urls ?? []) {
                        candidateUrs.set(url, { title: url, snippet: l.text });
                    }
                }

                const filterRes = filterWithTracking(rawLearnings, ctx.runId, {
                    requireEvidence: ctx.config.require_evidence_for_learnings ?? true,
                    defaultKind: 'research',
                    topicKeywords: state.topic_keywords,
                    topicGuardEnabled: ctx.config.topic_guard_enabled ?? true,
                    recencyEnabled: false, // pot corpus results don't have year markers — recency only for web step
                    existingTexts,
                });

                for (const [reason, count] of Object.entries(filterRes.rejectionCounts)) {
                    for (let i = 0; i < count; i++) {
                        // we don't know exactly which source produced the rejection here, assign to 'pot_batch'
                        tracker.recordLearningRejected('pot_batch', reason);
                    }
                }

                for (const l of filterRes.accepted) {
                    state.learnings.push(l);
                    tracker.recordLearningAccepted('pot_batch', l);
                    batchYield++;
                }
            }

            // 4. Triage candidate URLs
            const triageInput = Array.from(candidateUrs.entries())
                .filter(([url]) => !state.visited_urls.has(url))
                .map(([url, data]) => buildTriageCandidate(url, data.title, data.snippet));

            const triageOutputs = await triageUrls(triageInput, ctx.goalPrompt, state.topic_keywords, model, budget);

            const passedUrls = triageOutputs.filter((t) => t.pass).map((t) => t.url);
            const rejectedUrls = triageOutputs.filter((t) => !t.pass);

            for (const t of rejectedUrls) {
                tracker.recordTriageRejection(t.url, t.relevant_to_topic < 0.6 ? 'low_relevance' : 'not_recent');
            }
            for (const t of passedUrls) {
                tracker.recordTriagePass(t);
            }

            // 5. Ingest passed URLs
            const urlsToIngest = passedUrls.slice(0, batchSize);
            let ingestedCount = 0;

            const prevSourcesTotal = escalatorState.sourcesTotal;

            if (urlsToIngest.length > 0 && ctx.ingestor) {
                for (const url of urlsToIngest) {
                    if (state.visited_urls.has(url)) continue;
                    if (escalatorState.sourcesTotal >= maxSourcesTotal) break;

                    try {
                        state.visited_urls.add(url);
                        budget.check();
                        const entry = await ctx.ingestor.ingest(url, url, '');
                        state.sources_ingested.push({ url, sha256: entry.content_sha256, entry_id: entry.id });
                        budget.record({ web_pages_fetched: 1, total_sources: 1 });
                        escalatorState.sourcesTotal++;
                        ingestedCount++;
                    } catch (err) {
                        logger.warn({ url, error: String(err), msg: 'Web fetch failed in escalator' });
                    }
                }
            }

            // 6. Extract from newly ingested URLs
            if (ingestedCount > 0) {
                const newlyIngestedIds = state.sources_ingested.slice(-ingestedCount).map((s) => s.entry_id);
                const followUpQuery = queries[0] ?? ctx.goalPrompt.substring(0, 200);

                // Use a generic query to force extraction from these specific docs
                const followUpRaw = await ctx.corpus.search(followUpQuery, newlyIngestedIds.length * 2);
                const followUpResults = followUpRaw.filter((r) => newlyIngestedIds.includes(r.entry_id));

                if (followUpResults.length > 0) {
                    for (const r of followUpResults) {
                        state.visited_entry_ids.add(r.entry_id);
                        if (!state.entries_read.find((e) => e.id === r.entry_id)) {
                            state.entries_read.push({ id: r.entry_id, sha256: r.sha256 });
                        }
                    }
                    budget.record({ entries_read: followUpResults.length });

                    const rawLearnings = await extractLearnings(
                        ctx.goalPrompt, followUpQuery, followUpResults, model, learningPromptV2, budget, 'research'
                    );

                    // Build a map of entry_id -> source_id for tracking
                    const urlByEntryId = new Map<string, string>();
                    for (const s of state.sources_ingested) urlByEntryId.set(s.entry_id, s.url);

                    for (const l of rawLearnings) {
                        // Find which ingested source this came from
                        let sourceId = 'unknown_web';
                        for (const id of l.source_entry_ids ?? []) {
                            if (urlByEntryId.has(String(id))) {
                                sourceId = urlByEntryId.get(String(id))!;
                                break;
                            }
                        }
                        tracker.recordLearningCandidate(sourceId);
                    }

                    const filterRes = filterWithTracking(rawLearnings, ctx.runId, {
                        requireEvidence: ctx.config.require_evidence_for_learnings ?? true,
                        defaultKind: 'research',
                        topicKeywords: state.topic_keywords,
                        topicGuardEnabled: ctx.config.topic_guard_enabled ?? true,
                        recencyEnabled: true,
                        existingTexts,
                    });

                    for (const l of filterRes.accepted) {
                        let sourceId = 'unknown_web';
                        for (const id of l.source_entry_ids ?? []) {
                            if (urlByEntryId.has(String(id))) {
                                sourceId = urlByEntryId.get(String(id))!;
                                break;
                            }
                        }
                        state.learnings.push(l);
                        tracker.recordLearningAccepted(sourceId, l);
                        batchYield++;
                    }
                }
            }

            escalatorState.candidatesTotal += batchYield;

            logger.info({
                batch_index: escalatorState.batchIndex,
                stage: escalatorState.stage,
                batch_yield: batchYield,
                candidates_total: escalatorState.candidatesTotal,
                sources_total: escalatorState.sourcesTotal,
            }, 'Escalator batch complete');

            await saveCheckpointFn(state, escalatorState, budget, tracker);

            // 7. Stopping logic
            if (escalatorState.candidatesTotal >= targetCandidates && escalatorState.sourcesTotal >= minExternalSources) {
                logger.info({ msg: 'Escalator target met' });
                return buildResult('TARGET_MET', state, escalatorState, tracker);
            }

            if (escalatorState.sourcesTotal >= maxSourcesTotal) {
                logger.info({ msg: 'Escalator hard ceiling reached' });
                return buildResult('HARD_CEILING', state, escalatorState, tracker);
            }

            // Stage escalation
            if (batchYield < minNewCandidatesPerBatch) {
                escalatorState.lowYieldCount++;
                if (escalatorState.lowYieldCount >= maxLowYieldBatches) {
                    if (escalatorState.stage < 3) {
                        escalatorState.stage++;
                        escalatorState.lowYieldCount = 0;
                        logger.info({ new_stage: escalatorState.stage, msg: 'Escalating query complexity stage' });
                    } else {
                        logger.info({ msg: 'Diminishing returns at max stage' });
                        return buildResult('DIMINISHING_RETURNS', state, escalatorState, tracker);
                    }
                }
            } else {
                escalatorState.lowYieldCount = 0; // reset on good yield
            }

            escalatorState.batchIndex++;
        }

        // fallback return if loop breaks
        return buildResult('DIMINISHING_RETURNS', state, escalatorState, tracker);

    } catch (err) {
        if (err instanceof BudgetExceededError) {
            logger.warn({ violations: err.violations, msg: 'Budget hit in escalator' });
            return buildResult('BUDGET', state, escalatorState, tracker);
        }
        throw err;
    }
}

function buildResult(stopReason: 'TARGET_MET' | 'HARD_CEILING' | 'DIMINISHING_RETURNS' | 'BUDGET', state: ResearchState, _escalatorState: EscalatorState, tracker: RejectionTracker): EscalatorResult {
    return {
        learnings: state.learnings,
        sourcesIngested: state.sources_ingested,
        stopReason,
        rejectionSummary: tracker.getSummary(),
        sourceRecords: tracker.getSourceRecords(),
    };
}

// ----------------------------------------------------------------------------
// Extracted from execute.ts
// ----------------------------------------------------------------------------
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

        // Tag each learning
        for (const learning of result.learnings) {
            if (!learning.kind || learning.kind !== phase) {
                (learning as { kind: string }).kind = phase;
            }
        }

        return result.learnings;
    } catch {
        return [];
    }
}
