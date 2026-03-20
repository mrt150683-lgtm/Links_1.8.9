/**
 * URL Triage
 *
 * Pre-filters a batch of URL candidates with a cheap AI call before
 * spending web-fetch budget on them. Loads prompt from url_triage/v1.md.
 *
 * Fail-open: if parsing fails, all candidates pass triage.
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { AiUrlTriageResponseSchema } from '@links/core';
import type { UrlTriageItem } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import type { BudgetGuard } from './budget.js';

const logger = createLogger({ name: 'deep-research:urlTriage' });

export interface TriageCandidate {
    url: string;
    title: string;    // from corpus source_label or learning context
    snippet: string;  // first 200 chars of content or learning text
    domain: string;   // extracted from URL
}

export interface TriageResult extends TriageCandidate {
    relevant_to_topic: number;  // 0–1
    likely_2023_plus: number;   // 0–1
    source_type: 'paper' | 'repo' | 'lab' | 'blog' | 'other';
    pass: boolean;              // relevant >= 0.6 AND recent >= 0.6
}

/** Extract domain from a URL, returns empty string on failure */
function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/**
 * Build a TriageCandidate from a raw URL and any available context.
 */
export function buildTriageCandidate(
    url: string,
    title?: string,
    snippet?: string,
): TriageCandidate {
    return {
        url,
        title: (title ?? '').substring(0, 120),
        snippet: (snippet ?? '').substring(0, 200),
        domain: extractDomain(url),
    };
}

/**
 * Batch-triage a list of URL candidates via a single cheap AI call.
 * Returns TriageResult[] preserving order. Fail-open on parse error.
 */
export async function triageUrls(
    candidates: TriageCandidate[],
    goalPrompt: string,
    topicKeywords: string[],
    model: string,
    budget: BudgetGuard,
): Promise<TriageResult[]> {
    if (candidates.length === 0) return [];

    const PROMPTS_DIR = getPromptsDir();
    let prompt: ReturnType<typeof loadPromptFromFile>;
    try {
        prompt = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'url_triage', 'v1.md'));
    } catch (err) {
        logger.warn({ msg: 'url_triage prompt not found, failing open', error: String(err) });
        return candidates.map((c) => ({ ...c, relevant_to_topic: 1, likely_2023_plus: 1, source_type: 'other' as const, pass: true }));
    }

    const candidateList = candidates
        .map((c, i) => `${i + 1}. URL: ${c.url}\n   Title: ${c.title}\n   Domain: ${c.domain}\n   Snippet: ${c.snippet}`)
        .join('\n\n');

    const messages = interpolatePrompt(prompt, {
        goal_prompt: goalPrompt,
        topic_keywords: topicKeywords.slice(0, 15).join(', '),
        candidate_list: candidateList,
        candidate_count: String(candidates.length),
    });

    try {
        const response = await createChatCompletion({
            model,
            messages: [
                { role: 'system', content: messages.system },
                { role: 'user', content: messages.user },
            ],
            temperature: 0.1,
            max_tokens: 1500,
            response_format: { type: 'json_object' },
        });

        const raw = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;
        if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

        const parsed = AiUrlTriageResponseSchema.parse(JSON.parse(raw.trim()));

        // Build a lookup map by URL
        const resultMap = new Map<string, UrlTriageItem>(
            parsed.results.map((r) => [r.url, r]),
        );

        return candidates.map((c) => {
            const ai = resultMap.get(c.url);
            if (!ai) {
                // AI didn't score this URL — pass it through (fail-open per URL)
                return { ...c, relevant_to_topic: 1, likely_2023_plus: 1, source_type: 'other' as const, pass: true };
            }
            return {
                ...c,
                relevant_to_topic: ai.relevant_to_topic,
                likely_2023_plus: ai.likely_2023_plus,
                source_type: ai.source_type,
                pass: ai.relevant_to_topic >= 0.6 && ai.likely_2023_plus >= 0.6,
            };
        });
    } catch (err) {
        logger.warn({
            msg: 'URL triage AI call failed — failing open (all pass)',
            error: err instanceof Error ? err.message : String(err),
        });
        return candidates.map((c) => ({
            ...c,
            relevant_to_topic: 1,
            likely_2023_plus: 1,
            source_type: 'other' as const,
            pass: true,
        }));
    }
}
