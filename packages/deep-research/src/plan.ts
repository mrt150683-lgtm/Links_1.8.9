/**
 * Research Plan Generator
 *
 * Generates a ResearchPlanArtifact from the goal prompt + pot summary.
 * The plan describes proposed depth/breadth, estimated costs, and sub-questions.
 */

import { join } from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import { getDatabase } from '@links/storage';
import { AiResearchPlanResponseSchema } from '@links/core';
import type { ResearchPlanArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import { getPromptsDir } from './promptsDir.js';
import type { ResearchContext } from './types.js';

const logger = createLogger({ name: 'deep-research:plan' });

/**
 * Generate a research plan for the given run context.
 */
export async function generateResearchPlan(
  ctx: ResearchContext,
  model: string
): Promise<ResearchPlanArtifact> {
  const PROMPTS_DIR = getPromptsDir();
  const promptPath = join(PROMPTS_DIR, 'deep_research', 'plan', 'v1.md');

  const prompt = loadPromptFromFile(promptPath);

  // Build pot summary (entry count + recent entries summary)
  const db = getDatabase();
  const potEntryCount = await db
    .selectFrom('entries')
    .select(db.fn.count<number>('id').as('count'))
    .where('pot_id', '=', ctx.potId)
    .executeTakeFirst()
    .then((r) => Number(r?.count ?? 0));

  const recentEntries = await db
    .selectFrom('entries')
    .select(['content_text', 'source_title', 'link_title'])
    .where('pot_id', '=', ctx.potId)
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  const potSummary = recentEntries
    .map((e) => (e.source_title || e.link_title || '').trim() + (e.content_text ? `: ${e.content_text.substring(0, 150)}` : ''))
    .filter(Boolean)
    .join('\n');

  const messages = interpolatePrompt(prompt, {
    goal_prompt: ctx.goalPrompt,
    pot_entry_count: String(potEntryCount),
    pot_summary: potSummary || 'No entries yet.',
    max_depth: String(ctx.config.budget.max_depth),
    max_breadth: String(ctx.config.budget.max_breadth),
    web_augmentation: ctx.config.web_augmentation_enabled ? 'enabled' : 'disabled',
  });

  logger.info({
    run_id: ctx.runId,
    model,
    prompt_id: prompt.metadata.id,
    msg: 'Generating research plan',
  });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: prompt.metadata.temperature ?? 0.2,
    max_tokens: prompt.metadata.max_tokens ?? 2000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error('AI returned empty plan response');

  const parsed = parseJsonSafe(raw);
  const plan = AiResearchPlanResponseSchema.parse(parsed);

  return {
    ...plan,
    pot_entry_count: potEntryCount,
    pot_summary: potSummary || undefined,
    web_augmentation: ctx.config.web_augmentation_enabled,
    data_scope: ctx.config.web_augmentation_enabled ? 'pot_and_web' : 'pot_only',
  };
}

function parseJsonSafe(raw: string): unknown {
  const trimmed = raw.trim();
  const codeBlock = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlock?.[1]) return JSON.parse(codeBlock[1]);
  return JSON.parse(trimmed);
}
