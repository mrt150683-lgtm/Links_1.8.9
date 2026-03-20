/**
 * Query Escalation
 *
 * Generates stage-appropriate search queries to maximise coverage when
 * early batches yield low results. All stages except Stage 3 are purely
 * deterministic (no AI call). Stage 3 uses an AI prompt for creative
 * rephrasings as a last resort.
 *
 * Stages:
 *   0 – Goal keyword combinations (generic)
 *   1 – Named technique × goal keyword pairs (technique-specific)
 *   2 – Domain-filtered patterns (github/arxiv + technique keywords)
 *   3 – AI-generated rephrasings from failed queries + learnings
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { AiQueryGenerationResponseSchema } from '@links/core';
import type { Learning } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import type { BudgetGuard } from './budget.js';

const logger = createLogger({ name: 'deep-research:queryEscalation' });

// Common domain prefixes for Stage 2 filtering
const DOMAIN_PATTERNS = ['site:github.com', 'site:arxiv.org', 'site:huggingface.co', 'site:paperswithcode.com'];

/**
 * Deduplicate queries against previousQueries set (case-insensitive).
 */
function dedup(queries: string[], previousQueries: string[]): string[] {
    const seen = new Set(previousQueries.map((q) => q.toLowerCase().trim()));
    return queries.filter((q) => {
        const key = q.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Stage 0: Goal keyword combinations — generic, deterministic.
 */
function stage0Queries(goalPrompt: string): string[] {
    const words = goalPrompt.match(/[a-zA-Z]{4,}/g) ?? [];
    const stopWords = new Set(['with', 'from', 'that', 'this', 'have', 'will', 'they', 'their', 'about', 'when', 'which', 'using', 'based', 'into']);
    const keywords = [...new Set(words.filter((w) => !stopWords.has(w.toLowerCase())))].slice(0, 6);

    const queries: string[] = [goalPrompt.substring(0, 200)];
    // Keyword combos
    for (let i = 0; i < keywords.length - 1; i++) {
        queries.push(`${keywords[i]} ${keywords[i + 1]} 2023 2024`);
        if (queries.length >= 6) break;
    }
    queries.push(`${keywords.slice(0, 3).join(' ')} research`);
    queries.push(`${keywords.slice(0, 3).join(' ')} implementation`);
    return queries.slice(0, 6);
}

/**
 * Stage 1: Named technique × goal keyword pairs — deterministic.
 */
function stage1Queries(goalPrompt: string, constraintLearnings: Learning[], researchLearnings: Learning[]): string[] {
    // Extract technical terms (capitalized words or acronyms) from learnings
    const techniquePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,8})\b/g;
    const techniqueSet = new Set<string>();

    for (const l of [...constraintLearnings, ...researchLearnings].slice(-20)) {
        const matches = l.text.match(techniquePattern) ?? [];
        for (const m of matches) techniqueSet.add(m);
    }

    const techniques = Array.from(techniqueSet).slice(0, 4);
    const goalWords = (goalPrompt.match(/[a-zA-Z]{4,}/g) ?? []).slice(0, 3);
    const queries: string[] = [];

    for (const tech of techniques) {
        for (const word of goalWords) {
            queries.push(`${tech} ${word} 2023 OR 2024`);
            if (queries.length >= 6) return queries;
        }
    }

    // Fallback: technique + "survey" or "benchmark"
    for (const tech of techniques) {
        queries.push(`${tech} survey`);
        queries.push(`${tech} benchmark performance`);
        if (queries.length >= 6) return queries.slice(0, 6);
    }

    return queries.slice(0, 6);
}

/**
 * Stage 2: Domain-filtered patterns — deterministic.
 */
function stage2Queries(goalPrompt: string, constraintLearnings: Learning[], previousQueries: string[]): string[] {
    const goalWords = (goalPrompt.match(/[a-zA-Z]{5,}/g) ?? []).slice(0, 3).join(' ');
    const techniquePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,8})\b/g;
    const techniqueSet = new Set<string>();
    for (const l of constraintLearnings.slice(-10)) {
        const matches = l.text.match(techniquePattern) ?? [];
        for (const m of matches) techniqueSet.add(m);
    }
    const techniques = Array.from(techniqueSet).slice(0, 3);

    const queries: string[] = [];
    for (const domain of DOMAIN_PATTERNS) {
        queries.push(`${domain} ${goalWords}`);
        if (techniques.length > 0) {
            queries.push(`${domain} ${techniques[0]} ${goalWords}`);
        }
        if (queries.length >= 6) break;
    }

    void previousQueries; // dedup is applied by caller
    return queries.slice(0, 6);
}

/**
 * Stage 3: AI-generated rephrasings — creative, uses one AI call.
 */
async function stage3Queries(
    goalPrompt: string,
    previousQueries: string[],
    researchLearnings: Learning[],
    model: string,
    budget: BudgetGuard,
): Promise<string[]> {
    const PROMPTS_DIR = getPromptsDir();
    let prompt: ReturnType<typeof loadPromptFromFile>;
    try {
        prompt = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'query_escalation', 'v1.md'));
    } catch {
        logger.warn({ msg: 'query_escalation prompt not found, using goal as fallback' });
        return [goalPrompt.substring(0, 200)];
    }

    const failedQuerySummary = previousQueries.slice(-10).map((q) => `- ${q}`).join('\n');
    const learningsSummary = researchLearnings
        .slice(-5)
        .map((l) => `- ${l.text.substring(0, 150)}`)
        .join('\n');

    const messages = interpolatePrompt(prompt, {
        goal_prompt: goalPrompt,
        failed_queries: failedQuerySummary || 'None',
        recent_learnings: learningsSummary || 'None yet.',
    });

    try {
        const response = await createChatCompletion({
            model,
            messages: [
                { role: 'system', content: messages.system },
                { role: 'user', content: messages.user },
            ],
            temperature: 0.4,
            max_tokens: 1000,
            response_format: { type: 'json_object' },
        });

        const raw = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;
        if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

        const parsed = AiQueryGenerationResponseSchema.parse(JSON.parse(raw.trim()));
        return parsed.queries;
    } catch (err) {
        logger.warn({ msg: 'Stage 3 query escalation AI call failed', error: String(err) });
        return [goalPrompt.substring(0, 200)];
    }
}

/**
 * Generate escalated queries for the given stage.
 * All results are deduplicated against previousQueries.
 */
export async function generateEscalatedQueries(
    stage: number,
    goalPrompt: string,
    constraintLearnings: Learning[],
    researchLearnings: Learning[],
    topicKeywords: string[],
    previousQueries: string[],
    model: string,
    budget: BudgetGuard,
): Promise<string[]> {
    logger.info({ stage, msg: 'Generating escalated queries' });
    void topicKeywords; // available for prompt use if needed

    let raw: string[];
    switch (stage) {
        case 0:
            raw = stage0Queries(goalPrompt);
            break;
        case 1:
            raw = stage1Queries(goalPrompt, constraintLearnings, researchLearnings);
            break;
        case 2:
            raw = stage2Queries(goalPrompt, constraintLearnings, previousQueries);
            break;
        default: // stage 3+
            raw = await stage3Queries(goalPrompt, previousQueries, researchLearnings, model, budget);
    }

    const deduped = dedup(raw, previousQueries);
    logger.info({ stage, generated: raw.length, after_dedup: deduped.length, msg: 'Escalated queries ready' });
    return deduped;
}
