/**
 * Phase 8: Classify Link Candidate Job Handler
 *
 * AI-based link classification with evidence validation
 * - Takes a pre-generated candidate pair
 * - Calls AI with strict JSON schema
 * - Validates evidence excerpts match entry texts exactly
 * - Writes link to database if confidence >= threshold
 * - Marks candidate as processed/skipped
 */

import { loadPromptFromFile, interpolatePrompt, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import { createChatCompletion } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getCandidateById,
  listNewCandidates,
  claimCandidate,
  markCandidateProcessed,
  markCandidateSkipped,
  insertLink,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { LinkClassificationSchema, validateLinkEvidence } from '@links/core';
import type { LinkClassification } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:classify-link-candidate' });
const PROMPTS_DIR = getPromptsDir();

// Confidence threshold for creating links
const MIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Classify link candidate job handler
 *
 * Processes one new link candidate for the given entry's pot.
 * Triggered by:
 * - Automatic batch processing after candidate generation
 * - Manual trigger
 */
export async function classifyLinkCandidateHandler(ctx: JobContext): Promise<void> {
  logger.info({
    job_id: ctx.jobId,
    pot_id: ctx.potId,
  }, 'Starting link classification');

  // 1. Validate context - need pot_id to fetch candidates
  if (!ctx.potId) {
    throw new Error('classify_link_candidate job requires pot_id');
  }

  // 2. Fetch one new candidate from pot
  const candidates = await listNewCandidates(ctx.potId, 1);
  if (candidates.length === 0) {
    logger.info({
      job_id: ctx.jobId,
      pot_id: ctx.potId,
    }, 'No new candidates to process');
    return;
  }

  const candidate = candidates[0];
  if (!candidate) {
    return; // TypeScript guard
  }

  const candidateId = candidate.id;

  // Atomically claim the candidate to prevent race conditions with concurrent workers
  const claimed = await claimCandidate(candidateId);
  if (!claimed) {
    logger.info({
      job_id: ctx.jobId,
      candidate_id: candidateId,
    }, 'Candidate already claimed by another worker, skipping');
    return;
  }

  logger.info({
    job_id: ctx.jobId,
    candidate_id: candidateId,
  }, 'Processing candidate');

  // 3. Get both entries
  const srcEntry = await getEntryById(candidate.src_entry_id);
  const dstEntry = await getEntryById(candidate.dst_entry_id);

  if (!srcEntry || !dstEntry) {
    logger.error({
      job_id: ctx.jobId,
      candidate_id: candidateId,
      src_entry_found: !!srcEntry,
      dst_entry_found: !!dstEntry,
    }, 'One or both entries not found');
    await markCandidateSkipped(candidateId);
    return;
  }

  if (!srcEntry.content_text || srcEntry.content_text.trim().length === 0 ||
      !dstEntry.content_text || dstEntry.content_text.trim().length === 0) {
    logger.info({
      job_id: ctx.jobId,
      candidate_id: candidateId,
      src_type: srcEntry.type,
      dst_type: dstEntry.type,
    }, 'One or both entries lack text content, skipping');
    await markCandidateSkipped(candidateId);
    return;
  }

  // 4. Get AI preferences
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.linking || prefs.default_model || 'x-ai/grok-4.1-fast';
  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 1500;

  // 4a. Resolve effective role for this pot
  const pot = await getPotById(ctx.potId);
  const role = await resolveEffectiveRole(pot ?? { id: ctx.potId, role_ref: null });
  logger.info({ job_id: ctx.jobId, role_ref: pot?.role_ref ?? null, role_hash: role.hash }, 'Resolved pot role');

  logger.info({
    job_id: ctx.jobId,
    model,
    temperature,
  }, 'Using AI model');

  // 5. Load prompt template
  const promptPath = join(PROMPTS_DIR, 'link_pair', 'v1.md');
  const prompt: PromptTemplate = loadPromptFromFile(promptPath);

  logger.info({
    job_id: ctx.jobId,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
  }, 'Loaded prompt');

  // 6. Call AI
  const messages = interpolatePrompt(prompt, {
    src_text: srcEntry.content_text,
    dst_text: dstEntry.content_text,
  });

  logger.info({
    job_id: ctx.jobId,
    src_entry_id: srcEntry.id,
    dst_entry_id: dstEntry.id,
  }, 'Calling AI for link classification');

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

  // 7. Parse JSON (strip markdown code blocks if present)
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
    }, 'AI returned invalid JSON');
    await markCandidateSkipped(candidateId);
    throw new Error('AI returned invalid JSON');
  }

  // 8. Validate schema
  const validation = LinkClassificationSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({
      job_id: ctx.jobId,
      error: validation.error.format(),
      response: parsed,
    }, 'Schema validation failed');
    await markCandidateSkipped(candidateId);
    throw new Error(`Schema validation failed: ${validation.error.message}`);
  }

  const classification: LinkClassification = validation.data;

  logger.info({
    job_id: ctx.jobId,
    link_type: classification.link_type,
    confidence: classification.confidence,
  }, 'AI classification received');

  // 9. Validate evidence excerpts
  const evidenceValidation = validateLinkEvidence(
    classification,
    srcEntry.content_text,
    dstEntry.content_text
  );

  if (evidenceValidation.length > 0) {
    logger.error({
      job_id: ctx.jobId,
      errors: evidenceValidation,
    }, 'Evidence validation failed');
    await markCandidateSkipped(candidateId);

    await logAuditEvent({
      actor: 'system',
      action: 'link_validation_failed',
      pot_id: candidate.pot_id,
      entry_id: srcEntry.id,
      metadata: {
        job_id: ctx.jobId,
        candidate_id: candidateId,
        errors: evidenceValidation,
      },
    });

    throw new Error(`Evidence validation failed: ${evidenceValidation.join('; ')}`);
  }

  logger.info({
    job_id: ctx.jobId,
  }, 'Evidence validation passed');

  // 10. Check confidence threshold
  if (classification.confidence < MIN_CONFIDENCE_THRESHOLD) {
    logger.info({
      job_id: ctx.jobId,
      confidence: classification.confidence,
      threshold: MIN_CONFIDENCE_THRESHOLD,
    }, 'Confidence below threshold, skipping link creation');

    await markCandidateSkipped(candidateId);

    await logAuditEvent({
      actor: 'system',
      action: 'link_skipped_low_confidence',
      pot_id: candidate.pot_id,
      entry_id: srcEntry.id,
      metadata: {
        job_id: ctx.jobId,
        candidate_id: candidateId,
        confidence: classification.confidence,
        threshold: MIN_CONFIDENCE_THRESHOLD,
      },
    });

    return;
  }

  // 11. Insert link into database
  const link = await insertLink({
    pot_id: candidate.pot_id,
    src_entry_id: srcEntry.id,
    dst_entry_id: dstEntry.id,
    link_type: classification.link_type,
    confidence: classification.confidence,
    rationale: classification.rationale,
    evidence: classification.evidence,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
  });

  if (!link) {
    // Link already exists (duplicate)
    logger.info({
      job_id: ctx.jobId,
      candidate_id: candidateId,
    }, 'Link already exists, skipping');

    await markCandidateProcessed(candidateId);
    return;
  }

  // 12. Mark candidate as processed
  await markCandidateProcessed(candidateId);

  // 13. Log audit event
  await logAuditEvent({
    actor: 'system',
    action: 'link_created',
    pot_id: candidate.pot_id,
    entry_id: srcEntry.id,
    metadata: {
      job_id: ctx.jobId,
      candidate_id: candidateId,
      link_id: link.id,
      link_type: classification.link_type,
      confidence: classification.confidence,
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    link_id: link.id,
    link_type: classification.link_type,
    confidence: classification.confidence,
  }, 'Link created successfully');
}
