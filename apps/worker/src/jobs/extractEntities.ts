/**
 * Phase 7: Extract Entities Job Handler
 *
 * Extracts named entities from text entry content using AI
 */

import { loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import { createChatCompletion } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getAIPreferences,
  logAuditEvent,
  enqueueJob,
} from '@links/storage';
import { insertArtifact } from '@links/storage';
import { EntitiesArtifactSchema } from '@links/core';
import type { EntitiesArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:extract-entities' });
const PROMPTS_DIR = getPromptsDir();

/**
 * Extract entities job handler
 */
export async function extractEntitiesHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('extract_entities job requires entry_id');
  }

  // 2. Get entry (must be type='text')
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
    });
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  if (!entry.content_text || entry.content_text.trim().length === 0) {
    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      type: entry.type,
    }, 'Skipping entry without text content');
    return;
  }

  // 3. Get AI preferences
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.entity_extraction || prefs.default_model || 'x-ai/grok-4.1-fast';
  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 1500;

  // 3a. Resolve effective role for this pot
  const pot = await getPotById(entry.pot_id);
  const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });
  logger.info({ job_id: ctx.jobId, role_ref: pot?.role_ref ?? null, role_hash: role.hash });

  logger.info({
    job_id: ctx.jobId,
    model,
    temperature,
  });

  // 4. Load prompt template
  const promptPath = join(PROMPTS_DIR, 'extract_entities', 'v1.md');
  const prompt: PromptTemplate = loadPromptFromFile(promptPath);

  logger.info({
    job_id: ctx.jobId,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
  });

  // 5. Call AI
  logger.info({
    job_id: ctx.jobId,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
  });

  const messages = interpolatePrompt(prompt, { content_text: entry.content_text });

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

  // 6. Parse JSON (strip markdown code blocks if present)
  let cleanedOutput = aiOutput.trim();

  // Remove markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
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
      cleaned_preview: cleanedOutput.substring(0, 200),
    });
    throw new Error('AI returned invalid JSON');
  }

  // 7. Validate schema
  const validation = EntitiesArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({
      job_id: ctx.jobId,
      error: validation.error.format(),
      response: parsed,
    });
    throw new Error(`Schema validation failed: ${validation.error.message}`);
  }

  const payload: EntitiesArtifact = validation.data;

  // 8. Store artifact (force=false, skip if exists for this prompt version + role)
  const artifact = await insertArtifact({
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    artifact_type: 'entities',
    schema_version: 1,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    payload,
    evidence: null, // Entities don't have evidence
    role_hash: role.hash,
  }, false);

  if (!artifact) {
    // Artifact already exists, skip
    logger.info({
      job_id: ctx.jobId,
      entities_count: payload.entities.length,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'artifact_skipped',
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      metadata: {
        artifact_type: 'entities',
        reason: 'already_exists',
        prompt_id: prompt.metadata.id,
        prompt_version: prompt.metadata.version,
      },
    });

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      artifact_type: 'entities',
    });

    // Chain to summarization (idempotent)
    await enqueueJob({
      job_type: 'summarize_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 40,
    });

    return;
  }

  // 9. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'artifact_created',
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    metadata: {
      artifact_id: artifact.id,
      artifact_type: 'entities',
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      entities_count: payload.entities.length,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    artifact_id: artifact.id,
    artifact_type: 'entities',
  });

  // 10. Chain to summarization
  await enqueueJob({
    job_type: 'summarize_entry',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    priority: 40,
  });

  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
    msg: 'Enqueued summarize_entry job',
  });
}
