/**
 * Phase 7: Tag Entry Job Handler
 *
 * Extracts tags from entry content using AI (text, docs, and images via vision)
 */

import { loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import { createChatCompletion } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getAssetById,
  readDecryptedAsset,
  getAIPreferences,
  logAuditEvent,
  enqueueJob,
} from '@links/storage';
import { insertArtifact } from '@links/storage';
import type { ContentPart } from '@links/ai';
import { TagsArtifactSchema } from '@links/core';
import type { TagsArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:tag-entry' });
const PROMPTS_DIR = getPromptsDir();

/**
 * Tag entry job handler
 */
export async function tagEntryHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('tag_entry job requires entry_id');
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

  const isImage = entry.type === 'image';

  // For non-image entries, require text content
  if (!isImage && !entry.content_text) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      type: entry.type,
      message: 'Entry has no content_text for tagging',
    });
    return;
  }

  // 3. Get AI preferences
  const prefs = await getAIPreferences();
  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 1000;

  // 3a. Resolve effective role for this pot
  const pot = await getPotById(entry.pot_id);
  const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });
  logger.info({ job_id: ctx.jobId, role_ref: pot?.role_ref ?? null, role_hash: role.hash });

  let model: string;
  let prompt: PromptTemplate;
  let aiMessages: { role: 'system' | 'user'; content: string | ContentPart[] }[];

  if (isImage) {
    // Image tagging: falls back to gemini-2.5-flash (vision-capable)
    model = prefs.task_models?.image_tagging || 'google/gemini-2.5-flash';

    // Load image asset
    if (!entry.asset_id) {
      throw new Error(`Image entry ${entry.id} has no asset_id`);
    }
    const asset = await getAssetById(entry.asset_id);
    if (!asset) {
      throw new Error(`Asset not found: ${entry.asset_id}`);
    }

    // Read and encode as base64 data URI
    const decryptedBuffer = await readDecryptedAsset(asset.storage_path);
    const base64 = decryptedBuffer.toString('base64');
    const dataUri = `data:${asset.mime_type};base64,${base64}`;

    // Load image tagging prompt
    const promptPath = join(PROMPTS_DIR, 'tag_image', 'v1.md');
    prompt = loadPromptFromFile(promptPath);

    const textMessages = interpolatePrompt(prompt, {});

    // Build multimodal message with image
    aiMessages = [
      { role: 'system', content: injectRoleIntoSystemPrompt(textMessages.system, role.text) },
      {
        role: 'user',
        content: [
          { type: 'text', text: textMessages.user },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ];

    logger.info({
      job_id: ctx.jobId,
      model,
      asset_id: asset.id,
      mime_type: asset.mime_type,
      message: 'Sending image for vision tagging',
    });
  } else {
    // Text/doc tagging
    model = prefs.task_models?.tagging || prefs.default_model || 'x-ai/grok-4.1-fast';

    const promptPath = join(PROMPTS_DIR, 'tag_entry', 'v1.md');
    prompt = loadPromptFromFile(promptPath);

    const textMessages = interpolatePrompt(prompt, { content_text: entry.content_text! });
    aiMessages = [
      { role: 'system', content: injectRoleIntoSystemPrompt(textMessages.system, role.text) },
      { role: 'user', content: textMessages.user },
    ];
  }

  logger.info({
    job_id: ctx.jobId,
    model,
    temperature,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
  });

  // 5. Call AI
  const response = await createChatCompletion({
    model,
    messages: aiMessages,
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    response_format: prompt.metadata.response_format === 'json_object' ? { type: 'json_object' } : undefined,
  });

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI response is empty');
  }

  // 6. Parse JSON (strip markdown code blocks if present, or extract JSON from text)
  let cleanedOutput = aiOutput.trim();

  // Remove markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedOutput);
  } catch {
    // Fallback: try to extract JSON object from response (handles vision models that wrap JSON in text)
    const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (error) {
        logger.error({
          job_id: ctx.jobId,
          error: error instanceof Error ? error.message : String(error),
          response_preview: aiOutput.substring(0, 200),
        });
        throw new Error('AI returned invalid JSON');
      }
    } else {
      logger.error({
        job_id: ctx.jobId,
        response_preview: aiOutput.substring(0, 200),
      });
      throw new Error('AI response contains no valid JSON');
    }
  }

  // 7. Validate schema
  const validation = TagsArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({
      job_id: ctx.jobId,
      error: validation.error.format(),
      response: parsed,
    });
    throw new Error(`Schema validation failed: ${validation.error.message}`);
  }

  const payload: TagsArtifact = validation.data;

  // Warn if no tags were extracted
  if (payload.tags.length === 0) {
    logger.warn({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      message: 'AI returned zero tags',
      content_length: entry.content_text?.length || 0,
    });
  }

  // 8. Store artifact (force=false, skip if exists for this prompt version + role)
  const artifact = await insertArtifact({
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    artifact_type: 'tags',
    schema_version: 1,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    payload,
    evidence: null, // Tags don't have evidence
    role_hash: role.hash,
  }, false);

  if (!artifact) {
    // Artifact already exists, skip
    logger.info({
      job_id: ctx.jobId,
      tags_count: payload.tags.length,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'artifact_skipped',
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      metadata: {
        artifact_type: 'tags',
        reason: 'already_exists',
        prompt_id: prompt.metadata.id,
        prompt_version: prompt.metadata.version,
      },
    });

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      artifact_type: 'tags',
    });

    // Chain to entity extraction for text/doc entries (idempotent)
    if (!isImage) {
      await enqueueJob({
        job_type: 'extract_entities',
        pot_id: entry.pot_id,
        entry_id: entry.id,
        priority: 50,
      });
    }

    // Chain to summarization for image entries
    if (isImage) {
      await enqueueJob({
        job_type: 'summarize_entry',
        pot_id: entry.pot_id,
        entry_id: entry.id,
        priority: 40,
      });
    }

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
      artifact_type: 'tags',
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      tags_count: payload.tags.length,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    artifact_id: artifact.id,
    artifact_type: 'tags',
  });

  // 10. Chain to entity extraction for text/doc entries
  if (!isImage) {
    await enqueueJob({
      job_type: 'extract_entities',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 50,
    });

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      msg: 'Enqueued extract_entities job',
    });
  }

  // Chain to summarization for image entries
  if (isImage) {
    await enqueueJob({
      job_type: 'summarize_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 40,
    });

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      msg: 'Enqueued summarize_entry job for image',
    });
  }
}
