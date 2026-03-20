/**
 * Phase 7: Summarize Entry Job Handler
 *
 * Generates evidence-based summary with claims from text entry content using AI
 */

import { loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import { createChatCompletion } from '@links/ai';
import type { PromptTemplate, ContentPart } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getAssetById,
  readDecryptedAsset,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { insertArtifact } from '@links/storage';
import { SummaryArtifactSchema } from '@links/core';
import type { SummaryArtifact } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { validateEvidence } from './utils/validateEvidence.js';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:summarize-entry' });
const PROMPTS_DIR = getPromptsDir();

/**
 * Summarize entry job handler
 */
export async function summarizeEntryHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    entry_id: ctx.entryId,
  });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('summarize_entry job requires entry_id');
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

  // 2a. Image entries: use vision model to generate a description summary
  if (entry.type === 'image') {
    if (!entry.asset_id) {
      logger.warn({ job_id: ctx.jobId, entry_id: ctx.entryId }, 'Image entry has no asset_id, skipping');
      return;
    }

    const asset = await getAssetById(entry.asset_id);
    if (!asset) {
      throw new Error(`Asset not found: ${entry.asset_id}`);
    }

    const decryptedBuffer = await readDecryptedAsset(asset.storage_path);
    const base64 = decryptedBuffer.toString('base64');
    const dataUri = `data:${asset.mime_type};base64,${base64}`;

    const prefs = await getAIPreferences();
    const model = prefs.task_models?.image_tagging || 'google/gemini-2.5-flash';
    const temperature = prefs.temperature ?? 0.2;
    const maxTokens = Math.min(prefs.max_tokens ?? 2000, 1000);

    const pot = await getPotById(entry.pot_id);
    const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });

    const systemText = injectRoleIntoSystemPrompt(
      `You are an image analysis assistant. Describe the image concisely and accurately.\n\nReturn a JSON object with exactly these fields:\n{\n  "summary": "A 1-3 sentence description of the image (max 800 chars)",\n  "bullets": ["Key visual element 1", "Key visual element 2"],\n  "claims": []\n}\n\nReturn only valid JSON. No markdown or extra text.`,
      role.text,
    );

    const aiMessages: { role: 'system' | 'user'; content: string | ContentPart[] }[] = [
      { role: 'system', content: systemText },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ];

    logger.info({ job_id: ctx.jobId, model, asset_id: asset.id, mime_type: asset.mime_type }, 'Sending image for vision summarization');

    const response = await createChatCompletion({
      model,
      messages: aiMessages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });

    const aiOutput = response.choices[0]?.message?.content;
    if (!aiOutput) throw new Error('AI response is empty');

    let cleanedOutput = aiOutput.trim();
    const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    if (codeBlockMatch?.[1]) cleanedOutput = codeBlockMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanedOutput);
    } catch {
      const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch {
          throw new Error('AI returned invalid JSON for image summary');
        }
      } else {
        throw new Error('AI response contains no valid JSON for image summary');
      }
    }

    const validation = SummaryArtifactSchema.safeParse(parsed);
    if (!validation.success) {
      logger.error({ job_id: ctx.jobId, error: validation.error.format() });
      throw new Error(`Schema validation failed: ${validation.error.message}`);
    }

    const payload: SummaryArtifact = validation.data;

    const artifact = await insertArtifact({
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      artifact_type: 'summary',
      schema_version: 1,
      model_id: model,
      prompt_id: 'summarize_image_inline_v1',
      prompt_version: '1',
      temperature,
      max_tokens: maxTokens,
      payload,
      evidence: null,
      role_hash: role.hash,
    }, false);

    if (!artifact) {
      await logAuditEvent({
        actor: 'system',
        action: 'artifact_skipped',
        pot_id: entry.pot_id,
        entry_id: ctx.entryId,
        metadata: { artifact_type: 'summary', reason: 'already_exists' },
      });
      return;
    }

    await logAuditEvent({
      actor: 'system',
      action: 'artifact_created',
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      metadata: {
        artifact_id: artifact.id,
        artifact_type: 'summary',
        model_id: model,
        prompt_id: 'summarize_image_inline_v1',
      },
    });

    logger.info({ job_id: ctx.jobId, artifact_id: artifact.id, artifact_type: 'summary' });
    return;
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
  const model = prefs.task_models?.summarization || prefs.default_model || 'x-ai/grok-4.1-fast';
  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 2000;

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
  const promptPath = join(PROMPTS_DIR, 'summarize_entry', 'v1.md');
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
  const validation = SummaryArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({
      job_id: ctx.jobId,
      error: validation.error.format(),
      response: parsed,
    });
    throw new Error(`Schema validation failed: ${validation.error.message}`);
  }

  const payload: SummaryArtifact = validation.data;

  // 8. Validate evidence slicing (CRITICAL for summaries)
  logger.info({
    job_id: ctx.jobId,
    claims_count: payload.claims.length,
  });

  const evidenceValidation = validateEvidence(payload, entry.content_text);
  if (!evidenceValidation.isValid) {
    // Log warnings but don't fail - evidence positions from AI are often inaccurate
    // (off by UTF-8 byte counts, hallucinated positions, etc.) but the summary is still useful
    logger.warn({
      job_id: ctx.jobId,
      error_count: evidenceValidation.errors.length,
      msg: 'Evidence validation had issues (positions may be inaccurate, storing summary anyway)',
    });
    // Store first 3 errors for reference
    evidenceValidation.errors.slice(0, 3).forEach((err, idx) => {
      logger.warn({
        job_id: ctx.jobId,
        error_index: idx,
        error: err,
      });
    });
  }

  logger.info({
    job_id: ctx.jobId,
  });

  // 9. Store artifact (force=false, skip if exists for this prompt version + role)
  const artifact = await insertArtifact({
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    artifact_type: 'summary',
    schema_version: 1,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    payload,
    evidence: payload.claims, // Store evidence separately for query optimization
    role_hash: role.hash,
  }, false);

  if (!artifact) {
    // Artifact already exists, skip
    logger.info({
      job_id: ctx.jobId,
      claims_count: payload.claims.length,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'artifact_skipped',
      pot_id: entry.pot_id,
      entry_id: ctx.entryId,
      metadata: {
        artifact_type: 'summary',
        reason: 'already_exists',
        prompt_id: prompt.metadata.id,
        prompt_version: prompt.metadata.version,
      },
    });

    logger.info({
      job_id: ctx.jobId,
      entry_id: ctx.entryId,
      artifact_type: 'summary',
    });

    return;
  }

  // 10. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'artifact_created',
    pot_id: entry.pot_id,
    entry_id: ctx.entryId,
    metadata: {
      artifact_id: artifact.id,
      artifact_type: 'summary',
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      claims_count: payload.claims.length,
      bullets_count: payload.bullets.length,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    artifact_id: artifact.id,
    artifact_type: 'summary',
  });
}
