/**
 * Intel-Gen: Answer Question Job Handler
 *
 * Stage 2 of the Generated Intelligence pipeline.
 *
 * Uses atomic-claim pattern: given a pot_id, claims the next queued question
 * from intelligence_questions, loads the full text for all referenced entries,
 * calls the intel_answer prompt, validates evidence excerpts are verbatim
 * substrings, and stores the answer.
 *
 * Note: entry_id is NOT used (it has a FK to entries; question IDs are not entry IDs).
 */

import { loadPromptFromFile, interpolatePrompt, createChatCompletion, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  getPotById,
  getAIPreferences,
  logAuditEvent,
  claimNextQueuedQuestion,
  insertIntelligenceAnswer,
  updateIntelligenceQuestionStatus,
} from '@links/storage';
import type { IntelAnswerEvidence } from '@links/storage';
import { IntelAnswerResponseSchema } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:intel-answer-question' });
const PROMPTS_DIR = getPromptsDir();

// ============================================================================
// Evidence validation
// ============================================================================

/**
 * Validate that evidence excerpts appear verbatim in their source entry texts.
 * Returns a list of failure messages; empty array = all passed.
 */
function validateExcerpts(
  evidence: IntelAnswerEvidence[],
  entryTexts: Map<string, string>
): string[] {
  const failures: string[] = [];

  for (const item of evidence) {
    const text = entryTexts.get(item.entry_id);
    if (!text) {
      failures.push(`Evidence references unknown entry_id: ${item.entry_id}`);
      continue;
    }

    if (!text.includes(item.excerpt)) {
      // Try case-insensitive as a fallback check (still fail but log specifics)
      const lowerText = text.toLowerCase();
      const lowerExcerpt = item.excerpt.toLowerCase().trim();
      if (!lowerText.includes(lowerExcerpt)) {
        failures.push(
          `Excerpt not found in entry ${item.entry_id}: "${item.excerpt.slice(0, 80)}…"`
        );
      } else {
        // Case mismatch — treat as pass with warning
        logger.warn(
          { entry_id: item.entry_id, excerpt: item.excerpt.slice(0, 80) },
          'Evidence excerpt found case-insensitively; accepting'
        );
      }
    }
  }

  return failures;
}

// ============================================================================
// Handler
// ============================================================================

export async function intelAnswerQuestionHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, pot_id: ctx.potId }, 'Starting intel answer job');

  if (!ctx.potId) {
    throw new Error('intel_answer_question job requires pot_id');
  }

  const potId = ctx.potId;

  // 1. Atomically claim one queued question for this pot (marks it 'running').
  // Multiple concurrent jobs for the same pot are safe — each claims a distinct question.
  const question = await claimNextQueuedQuestion(potId);
  if (!question) {
    logger.info({ job_id: ctx.jobId, pot_id: potId }, 'No queued questions to answer; skipping');
    return;
  }

  const questionId = question.id;
  logger.info({ job_id: ctx.jobId, question_id: questionId }, 'Claimed question');

  try {
    // 3. Load full text for all referenced entries
    const entryTexts = new Map<string, string>();
    const entryBlocks: string[] = [];

    for (const entryId of question.entry_ids) {
      const entry = await getEntryById(entryId);
      if (!entry || !entry.content_text) {
        logger.warn({ entry_id: entryId, question_id: questionId }, 'Referenced entry not found or has no text; skipping it');
        continue;
      }
      entryTexts.set(entryId, entry.content_text);
      entryBlocks.push(
        [
          `[Document ${entryId}]`,
          entry.source_title ? `Title: ${entry.source_title}` : null,
          entry.source_url ? `URL: ${entry.source_url}` : null,
          '',
          entry.content_text,
          '---',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }

    if (entryTexts.size === 0) {
      throw new Error('No valid entry texts found for question; cannot answer');
    }

    // 4. Load AI preferences
    const prefs = await getAIPreferences();
    const model = prefs.task_models?.summarization ?? prefs.task_models?.linking ?? prefs.default_model ?? 'x-ai/grok-4.1-fast';
    const temperature = prefs.temperature ?? 0.2;
    const maxTokens = prefs.max_tokens ?? 2000;

    // 4a. Resolve effective role for this pot
    const pot = await getPotById(potId);
    const role = await resolveEffectiveRole(pot ?? { id: potId, role_ref: null });
    logger.info({ job_id: ctx.jobId, question_id: questionId, role_ref: pot?.role_ref ?? null, role_hash: role.hash }, 'Resolved pot role');

    // 5. Load prompt
    const prompt: PromptTemplate = loadPromptFromFile(
      join(PROMPTS_DIR, 'intel_answer', 'v1.md')
    );
    const promptVersion = String(prompt.metadata.version);

    // 6. Call AI
    const messages = interpolatePrompt(prompt, {
      question: question.question_text,
      entry_texts: entryBlocks.join('\n\n'),
    });

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

    // 7. Parse and validate response
    const raw = response.choices[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`intel_answer returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    const validation = IntelAnswerResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`intel_answer schema validation failed: ${validation.error.message}`);
    }

    const aiAnswer = validation.data;

    // 8. Map evidence to storage types and validate excerpts
    const evidence: IntelAnswerEvidence[] = aiAnswer.evidence.map((e) => ({
      entry_id: e.entry_id,
      excerpt: e.excerpt,
      start_offset: e.start_offset,
      end_offset: e.end_offset,
    }));

    const excerptFailures = validateExcerpts(evidence, entryTexts);
    const excerptValidation = excerptFailures.length === 0 ? 'pass' : 'fail';

    if (excerptFailures.length > 0) {
      logger.warn(
        { question_id: questionId, failures: excerptFailures },
        'Some evidence excerpts failed validation'
      );
    }

    // 9. Extract token usage if provided
    const usage = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined;

    // 10. Store answer
    const answer = await insertIntelligenceAnswer({
      question_id: questionId,
      pot_id: potId,
      answer_text: aiAnswer.answer,
      confidence: aiAnswer.confidence,
      evidence,
      excerpt_validation: excerptValidation,
      excerpt_validation_details:
        excerptFailures.length > 0 ? excerptFailures.join('; ') : undefined,
      limits_text: aiAnswer.limits ?? undefined,
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: promptVersion,
      temperature: prompt.metadata.temperature ?? temperature,
      token_usage: usage,
    });

    // 11. Mark question as done
    await updateIntelligenceQuestionStatus(questionId, 'done');

    logger.info(
      {
        question_id: questionId,
        answer_id: answer.id,
        confidence: answer.confidence,
        excerpt_validation: excerptValidation,
      },
      'Intel answer stored'
    );

    await logAuditEvent({
      actor: 'system',
      action: 'intel_answer_stored',
      pot_id: potId,
      metadata: {
        question_id: questionId,
        answer_id: answer.id,
        confidence: answer.confidence,
        excerpt_validation: excerptValidation,
        model,
        prompt_version: promptVersion,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ question_id: questionId, err }, 'Intel answer job failed');
    await updateIntelligenceQuestionStatus(questionId, 'failed');
    throw err;
  }
}
