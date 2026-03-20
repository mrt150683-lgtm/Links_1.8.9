/**
 * dyk_generate_for_entry Job Handler
 *
 * Generates "Did You Know" micro-insights from a processed entry
 * using AI. Runs after summarize_entry creates a summary artifact.
 *
 * Steps:
 *  1. Validate context (entry_id required)
 *  2. Load entry — skip if content_text < 50 chars
 *  3. Load artifacts: summary, tags, entities
 *  4. Get AI prefs + model
 *  5. Resolve role
 *  6. Load prompt
 *  7. Build messages
 *  8. Call AI
 *  9. Parse JSON
 * 10. Validate schema
 * 11. Score novelty + build inputs
 * 12. Insert items
 * 13. Audit log
 */

import { loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import { createChatCompletion } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getPotDykState,
  getAIPreferences,
  getLatestArtifact,
  logAuditEvent,
  getExistingItemsForNovelty,
  computeDykSignature,
  computeDykNovelty,
  insertDykItems,
} from '@links/storage';
import { DykAiOutputSchema } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:dyk-generate-for-entry' });
const PROMPTS_DIR = getPromptsDir();

const NOVELTY_THRESHOLD = 0.35;
const MIN_CONTENT_LENGTH = 50;

/**
 * Serialize an artifact's payload to a compact string for prompt context.
 */
function serializeArtifact(artifact: { payload: unknown } | null, label: string): string {
  if (!artifact) return `No ${label} available.`;
  try {
    return JSON.stringify(artifact.payload, null, 0);
  } catch {
    return `No ${label} available.`;
  }
}

export async function dykGenerateForEntryHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId, msg: 'dyk_generate_for_entry starting' });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('dyk_generate_for_entry job requires entry_id');
  }

  // 2. Load entry
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    logger.warn({ job_id: ctx.jobId, entry_id: ctx.entryId, msg: 'Entry not found, skipping' });
    return;
  }

  if (!entry.content_text || entry.content_text.trim().length < MIN_CONTENT_LENGTH) {
    logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId, msg: 'Entry content too short, skipping' });
    return;
  }

  // 3. Load artifacts
  const [summaryArtifact, tagsArtifact, entitiesArtifact] = await Promise.all([
    getLatestArtifact(ctx.entryId, 'summary'),
    getLatestArtifact(ctx.entryId, 'tags'),
    getLatestArtifact(ctx.entryId, 'entities'),
  ]);

  // 4. Get AI prefs + model
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.summarization || prefs.default_model || 'x-ai/grok-4.1-fast';
  const temperature = prefs.temperature ?? 0.3;
  const maxTokens = prefs.max_tokens ?? 2000;

  // 5. Resolve role
  const pot = await getPotById(entry.pot_id);
  const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });
  logger.info({ job_id: ctx.jobId, role_ref: pot?.role_ref ?? null, role_hash: role.hash });

  // 6. Load prompt
  const promptPath = join(PROMPTS_DIR, 'dyk_generate_from_entry', 'v1.md');
  const prompt: PromptTemplate = loadPromptFromFile(promptPath);

  // 7. Build messages
  const rawDykState = pot ? await getPotDykState(pot.id) : null;
  const dykState = rawDykState;

  const preferenceHint = dykState?.liked_topics
    ? `Preference hint: Focus on topics related to: ${dykState.liked_topics.join(', ')}`
    : '';

  const variables = {
    entry_id: ctx.entryId,
    content_text: entry.content_text.substring(0, 8000), // Cap to avoid token overflow
    summary_artifact: serializeArtifact(summaryArtifact, 'summary'),
    tags_artifact: serializeArtifact(tagsArtifact, 'tags'),
    entities_artifact: serializeArtifact(entitiesArtifact, 'entities'),
    preference_hint: preferenceHint,
  };

  const messages = interpolatePrompt(prompt, variables);

  // 8. Call AI
  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: injectRoleIntoSystemPrompt(messages.system, role.text) },
      { role: 'user', content: messages.user },
    ],
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    response_format: prompt.metadata.response_format === 'json_object' ? { type: 'json_object' } : undefined,
  });

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI response is empty');
  }

  // 9. Parse JSON (strip markdown code blocks if present)
  let cleanedOutput = aiOutput.trim();
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch?.[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedOutput);
  } catch (error) {
    logger.error({
      job_id: ctx.jobId,
      error: error instanceof Error ? error.message : String(error),
      response_preview: aiOutput.substring(0, 200),
    });
    throw new Error('AI returned invalid JSON');
  }

  // 10. Validate schema
  const validation = DykAiOutputSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({
      job_id: ctx.jobId,
      error: validation.error.format(),
      response: parsed,
    });
    throw new Error(`DYK schema validation failed: ${validation.error.message}`);
  }

  const candidates = validation.data.items;
  logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId, count: candidates.length, msg: 'Got DYK candidates from AI' });

  // 11. Score novelty + build inputs
  const existingItems = await getExistingItemsForNovelty(entry.pot_id);

  const validItems = [];
  for (const candidate of candidates) {
    const signature = computeDykSignature(
      candidate.title,
      candidate.body,
      candidate.keywords,
      'entry_summary',
      String(prompt.metadata.version),
      role.hash,
    );

    const novelty = computeDykNovelty(candidate.keywords, existingItems);

    if (novelty < NOVELTY_THRESHOLD) {
      logger.info({
        job_id: ctx.jobId,
        title: candidate.title.substring(0, 50),
        novelty,
        msg: 'Skipping DYK item — novelty below threshold',
      });
      continue;
    }

    // Warn if evidence excerpts look misaligned (non-blocking)
    for (const ev of candidate.source_evidence) {
      if (ev.end <= ev.start) {
        logger.warn({
          job_id: ctx.jobId,
          entry_id: ev.entry_id,
          start: ev.start,
          end: ev.end,
          msg: 'DYK evidence: end <= start, positions may be inaccurate',
        });
      }
    }

    validItems.push({
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      title: candidate.title,
      body: candidate.body,
      keywords: candidate.keywords,
      confidence: candidate.confidence,
      novelty,
      source_type: 'entry_summary' as const,
      signature,
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: String(prompt.metadata.version),
      role_hash: role.hash,
      evidence: candidate.source_evidence.length > 0 ? candidate.source_evidence : undefined,
    });
  }

  // 12. Insert items
  const inserted = await insertDykItems(validItems);
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    candidates: candidates.length,
    valid: validItems.length,
    inserted: inserted.length,
    msg: 'DYK items inserted',
  });

  // 13. Audit log
  await logAuditEvent({
    actor: 'system',
    action: 'dyk_generated',
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    metadata: {
      count: inserted.length,
      entry_id: ctx.entryId,
      model_id: model,
      prompt_version: String(prompt.metadata.version),
    },
  });
}
