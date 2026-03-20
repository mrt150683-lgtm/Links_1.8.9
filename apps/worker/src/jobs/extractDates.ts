/**
 * extract_dates Job Handler
 *
 * AI-powered date extraction following the standard 10-step job pattern.
 * Extracts date mentions from entry.content_text, stores a derived_artifact
 * of type 'date_mentions', then chains to calendar_sync.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getAIPreferences,
  insertArtifact,
  logAuditEvent,
  enqueueJob,
  toDateKey,
  getSystemTimezone,
} from '@links/storage';
import {
  loadPromptFromFile,
  createChatCompletion,
  resolveEffectiveRole,
  injectRoleIntoSystemPrompt,
  interpolatePrompt,
} from '@links/ai';
import { DateMentionsArtifactSchema, validateDateMentionEvidence } from '@links/core';
import type { DateMentionsArtifact } from '@links/core';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:extract-dates' });
const PROMPTS_DIR = getPromptsDir();

export async function extractDatesHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId });

  // 1. Validate context
  if (!ctx.entryId) {
    throw new Error('extract_dates job requires entry_id');
  }

  // 2. Load entry
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  if (!entry.content_text || entry.content_text.trim().length === 0) {
    logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId }, 'Skipping entry without text content');
    return;
  }

  // 3. Get AI preferences
  const prefs = await getAIPreferences();
  const model = prefs.task_models?.date_extraction || prefs.default_model || 'openai/gpt-4o-mini';
  const temperature = prefs.temperature ?? 0.2;
  const maxTokens = prefs.max_tokens ?? 2000;

  // 4. Resolve effective role for this pot
  const pot = await getPotById(entry.pot_id);
  const role = await resolveEffectiveRole(pot ?? { id: entry.pot_id, role_ref: null });

  logger.info({ job_id: ctx.jobId, model, role_hash: role.hash });

  // 5. Load prompt + compute reference_date
  const promptPath = join(PROMPTS_DIR, 'extract_dates', 'v1.md');
  const prompt = loadPromptFromFile(promptPath);
  const tz = prefs.calendar_timezone ?? getSystemTimezone();
  const reference_date = toDateKey(entry.captured_at, tz);

  logger.info({
    job_id: ctx.jobId,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
    reference_date,
  });

  // 6. Build messages
  const messages = interpolatePrompt(prompt, {
    content_text: entry.content_text,
    reference_date,
    timezone: tz,
  });

  // 7. Call AI
  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: injectRoleIntoSystemPrompt(messages.system, role.text) },
      { role: 'user', content: messages.user },
    ],
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    response_format: { type: 'json_object' },
  });

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI returned empty response');
  }

  // 8. Parse + validate
  let cleanedOutput = aiOutput.trim();
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch?.[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedOutput);
  } catch {
    throw new Error('AI returned invalid JSON for date extraction');
  }

  const validation = DateMentionsArtifactSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: ctx.jobId, error: validation.error.format() });
    throw new Error(`Date mentions schema validation failed: ${validation.error.message}`);
  }

  let payload: DateMentionsArtifact = validation.data;

  // Filter mentions with invalid evidence (don't fail — just drop bad ones)
  const evidenceErrors = validateDateMentionEvidence(payload, entry.content_text);
  if (evidenceErrors.length > 0) {
    logger.warn({
      job_id: ctx.jobId,
      error_count: evidenceErrors.length,
      msg: 'Some date mention evidence was invalid — filtering those out',
    });
    // Identify bad indexes from error messages and filter
    const badIndexes = new Set<number>();
    for (const err of evidenceErrors) {
      const match = err.match(/^Date (\d+)/);
      if (match?.[1] !== undefined) badIndexes.add(parseInt(match[1], 10));
    }
    payload = {
      ...payload,
      dates: payload.dates.filter((_, i) => !badIndexes.has(i)),
    };
  }

  logger.info({ job_id: ctx.jobId, dates_count: payload.dates.length });

  // 9. Store artifact (idempotent — skip if same prompt version + role)
  const artifact = await insertArtifact({
    pot_id: entry.pot_id,
    entry_id: entry.id,
    artifact_type: 'date_mentions',
    schema_version: 1,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? temperature,
    max_tokens: prompt.metadata.max_tokens ?? maxTokens,
    payload,
    evidence: null,
    role_hash: role.hash,
  }, false);

  if (!artifact) {
    logger.info({ job_id: ctx.jobId, msg: 'date_mentions artifact already exists — skipping' });
    return;
  }

  // Log audit event (metadata only — no raw content)
  await logAuditEvent({
    actor: 'system',
    action: 'artifact_created',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    metadata: {
      artifact_id: artifact.id,
      artifact_type: 'date_mentions',
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      dates_count: payload.dates.length,
    },
  });

  // 10. Chain to calendar_sync if there are dates to sync
  if (payload.dates.length > 0) {
    await enqueueJob({
      job_type: 'calendar_sync',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 45,
      payload: { artifact_id: artifact.id },
    });

    logger.info({ job_id: ctx.jobId, artifact_id: artifact.id, msg: 'Enqueued calendar_sync' });
  }
}
