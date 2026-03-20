/**
 * Delta Computation
 *
 * Compares current learnings vs. previous run learnings:
 * 1. Deterministic hash diff (new, removed)
 * 2. AI classification for "potential updates" (updated/contradicted/reinforced)
 *
 * Falls back to hash-only delta if AI call fails.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { AiDeltaComputationResponseSchema } from '@links/core';
import type { Learning, ResearchDeltaArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import type { BudgetGuard } from './budget.js';

const logger = createLogger({ name: 'deep-research:delta' });

function hashLearning(l: Learning): string {
  return createHash('sha256').update(l.text.trim().toLowerCase()).digest('hex');
}

/**
 * Compute delta between current and previous run learnings.
 */
export async function computeDelta(
  currentLearnings: Learning[],
  previousLearnings: Learning[],
  previousRunId: string,
  model: string,
  budget: BudgetGuard
): Promise<ResearchDeltaArtifact> {
  const currentHashes = new Map(currentLearnings.map((l) => [hashLearning(l), l]));
  const previousHashes = new Map(previousLearnings.map((l) => [hashLearning(l), l]));

  const newFindings: Learning[] = [];
  const removedFindings: Learning[] = [];
  const potentialUpdates: Array<{ prev: Learning; curr: Learning }> = [];

  // Find new findings (not in previous)
  for (const [hash, learning] of currentHashes) {
    if (!previousHashes.has(hash)) {
      newFindings.push(learning);
    }
  }

  // Find removed findings (not in current)
  for (const [hash, learning] of previousHashes) {
    if (!currentHashes.has(hash)) {
      removedFindings.push(learning);
    }
  }

  // Find potential updates (similar text, different hash)
  // Heuristic: if text similarity > 60% (simple: shared words ratio)
  for (const prevLearning of previousLearnings) {
    const prevHash = hashLearning(prevLearning);
    if (currentHashes.has(prevHash)) continue; // Exact match, not removed

    for (const currLearning of newFindings) {
      if (textSimilarity(prevLearning.text, currLearning.text) > 0.6) {
        potentialUpdates.push({ prev: prevLearning, curr: currLearning });
        break;
      }
    }
  }

  // AI classification for potential updates (optional)
  const changedFindings: ResearchDeltaArtifact['changed_findings'] = [];

  if (potentialUpdates.length > 0) {
    try {
      const aiChanges = await classifyChanges(potentialUpdates, model, budget);
      changedFindings.push(...aiChanges);
    } catch (err) {
      logger.warn({
        error: err instanceof Error ? err.message : String(err),
        msg: 'AI delta classification failed, using hash-only delta',
      });
    }
  }

  // Unresolved questions: open_loops from previous that aren't addressed in current
  const unresolvedQuestions = removedFindings
    .filter((l) => l.confidence < 0.5)
    .map((l) => `Unresolved: ${l.text}`);

  const summary = buildDeltaSummary(newFindings, changedFindings, removedFindings);

  return {
    previous_run_id: previousRunId,
    new_findings: newFindings,
    changed_findings: changedFindings,
    removed_findings: removedFindings,
    unresolved_questions: unresolvedQuestions,
    summary,
  };
}

async function classifyChanges(
  updates: Array<{ prev: Learning; curr: Learning }>,
  model: string,
  budget: BudgetGuard
): Promise<ResearchDeltaArtifact['changed_findings']> {
  const PROMPTS_DIR = getPromptsDir();
  const prompt = loadPromptFromFile(join(PROMPTS_DIR, 'deep_research', 'delta_computation', 'v1.md'));

  const updatesText = updates
    .slice(0, 10) // Limit to 10 pairs
    .map((u, i) => `Pair ${i + 1}:\n  Previous: ${u.prev.text}\n  Current: ${u.curr.text}`)
    .join('\n\n');

  const messages = interpolatePrompt(prompt, { updates: updatesText });

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

  const parsed = JSON.parse(raw.trim());
  const result = AiDeltaComputationResponseSchema.parse(parsed);

  // Map AI result back to our full Learning objects
  return result.changed_findings.map((cf, i) => ({
    previous: updates[i]?.prev ?? cf.previous,
    current: updates[i]?.curr ?? cf.current,
    change_type: cf.change_type,
  }));
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function buildDeltaSummary(
  newFindings: Learning[],
  changedFindings: ResearchDeltaArtifact['changed_findings'],
  removedFindings: Learning[]
): string {
  const parts: string[] = [];
  if (newFindings.length > 0) parts.push(`${newFindings.length} new finding(s)`);
  if (changedFindings.length > 0) parts.push(`${changedFindings.length} changed finding(s)`);
  if (removedFindings.length > 0) parts.push(`${removedFindings.length} removed finding(s)`);
  return parts.length > 0 ? `Delta: ${parts.join(', ')}.` : 'No changes detected between runs.';
}
