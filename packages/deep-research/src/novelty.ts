/**
 * Novelty Scoring
 *
 * Scores novelty of current run's findings vs. prior learnings + pot summaries.
 * Detects contradictions and keyword matches.
 * Triggers notifications if thresholds are exceeded.
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { AiNoveltyResponseSchema } from '@links/core';
import type { Learning, ResearchNoveltyArtifact, ResearchRunConfig } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import type { BudgetGuard } from './budget.js';

const logger = createLogger({ name: 'deep-research:novelty' });

/**
 * Compute novelty score for the current run's findings.
 */
export async function computeNovelty(
  currentLearnings: Learning[],
  priorLearnings: Learning[],
  potSummaries: string[],
  config: ResearchRunConfig,
  model: string,
  budget: BudgetGuard
): Promise<ResearchNoveltyArtifact> {
  const PROMPTS_DIR = getPromptsDir();
  const prompt = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'novelty_scoring', 'v1.md'));

  // Top new findings (not in prior by text hash)
  const priorTexts = new Set(priorLearnings.map((l) => l.text.trim().toLowerCase()));
  const topNewFindings = currentLearnings
    .filter((l) => !priorTexts.has(l.text.trim().toLowerCase()))
    .slice(0, 20);

  if (topNewFindings.length === 0) {
    // No new findings → trivially low novelty
    return {
      novelty_score: 0,
      top_new_findings: [],
      contradictions: [],
      keyword_matches: [],
      alert_triggered: false,
      alert_reasons: [],
    };
  }

  const newFindingsText = topNewFindings
    .map((l, i) => `${i + 1}. ${l.text}`)
    .join('\n');

  const potSummaryText = potSummaries.slice(0, 5).join('\n\n') || 'No pot summaries available.';
  const keywordWatchlist = (config.keyword_watchlist ?? []).join(', ') || 'none';

  const messages = interpolatePrompt(prompt, {
    new_findings: newFindingsText,
    pot_summaries: potSummaryText,
    keyword_watchlist: keywordWatchlist,
    novelty_threshold: String(config.novelty_threshold),
    contradiction_threshold: String(config.contradiction_threshold),
  });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const usage = response.usage;
  if (usage) budget.record({ model_tokens: usage.total_tokens ?? 0 });

  try {
    const parsed = JSON.parse(raw.trim());
    const result = AiNoveltyResponseSchema.parse(parsed);

    // Determine if alert should be triggered
    const alertReasons: string[] = [];
    if (result.novelty_score >= config.novelty_threshold) {
      alertReasons.push(`novelty_score ${result.novelty_score.toFixed(2)} >= threshold ${config.novelty_threshold}`);
    }
    if (result.contradictions.some((c) => c.confidence >= config.contradiction_threshold)) {
      alertReasons.push('contradiction above threshold detected');
    }
    if (result.keyword_matches.length > 0) {
      alertReasons.push(`keyword matches: ${result.keyword_matches.join(', ')}`);
    }

    return {
      ...result,
      alert_triggered: alertReasons.length > 0,
      alert_reasons: alertReasons,
    };
  } catch (err) {
    logger.warn({
      error: err instanceof Error ? err.message : String(err),
      msg: 'Novelty scoring AI response invalid, returning minimal result',
    });

    return {
      novelty_score: 0,
      top_new_findings: topNewFindings.slice(0, 5).map((f) => ({ finding: f, novelty_reason: 'could not score' })),
      contradictions: [],
      keyword_matches: [],
      alert_triggered: false,
      alert_reasons: [],
    };
  }
}
