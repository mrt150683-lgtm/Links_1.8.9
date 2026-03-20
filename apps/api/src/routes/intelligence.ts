/**
 * Intel-Gen: Intelligence API Routes
 *
 * Endpoints for triggering and querying the Generated Intelligence pipeline.
 *
 * POST /intelligence/improve-prompt             — improve a custom research focus with AI
 * POST /pots/:potId/intelligence/generate       — trigger a new run
 * GET  /pots/:potId/intelligence/runs           — list runs for pot
 * GET  /pots/:potId/intelligence/questions      — list questions (optionally by run)
 * GET  /pots/:potId/intelligence/questions/:id  — get one question + its answer
 * GET  /pots/:potId/intelligence/answers        — list answers (optionally by question)
 * POST /pots/:potId/intelligence/answers/:id/promote — promote answer to artifact
 */

import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import {
  getPotById,
  listEntries,
  getAIPreferences,
  enqueueJob,
  logAuditEvent,
  insertIntelligenceRun,
  listIntelligenceRunsForPot,
  getIntelligenceRunById,
  listIntelligenceQuestionsForRun,
  listIntelligenceQuestionsForPot,
  getIntelligenceQuestionById,
  getIntelligenceAnswerByQuestionId,
  getIntelligenceAnswerById,
  listIntelligenceAnswersForPot,
  insertArtifact,
} from '@links/storage';
import { createChatCompletion } from '@links/ai';
import { createLogger } from '@links/logging';
import { z } from 'zod';

const logger = createLogger({ name: 'api:intelligence' });

// ============================================================================
// Request schemas
// ============================================================================

const GenerateIntelligenceBodySchema = z.object({
  mode: z.enum(['auto', 'full', 'digest']).optional().default('auto'),
  model_id: z.string().optional(),
  max_questions: z.number().int().min(1).max(20).optional().default(5),
  custom_prompt: z.string().max(5000).optional(),
});

const ImprovePromptBodySchema = z.object({
  draft: z.string().min(1).max(5000),
});

const ListQuestionsQuerySchema = z.object({
  run_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(100),
});

const ListAnswersQuerySchema = z.object({
  question_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(100),
});

const PromoteAnswerBodySchema = z.object({
  target: z.enum(['artifact']).optional().default('artifact'),
  note_title: z.string().max(200).optional(),
});

// ============================================================================
// Helpers
// ============================================================================

/** Estimate tokens from character count */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Build pot snapshot hash for context */
function buildPotSnapshotHash(
  entries: Array<{ id: string; content_sha256: string | null }>
): string {
  const sorted = [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `${e.id}:${e.content_sha256 ?? 'null'}`)
    .join('\n');
  return createHash('sha256').update(sorted).digest('hex');
}

// ============================================================================
// Plugin
// ============================================================================

export const intelligenceRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /pots/:potId/intelligence/generate
   * Trigger a new Generated Intelligence run for a pot.
   */
  fastify.post<{
    Params: { potId: string };
    Body: z.infer<typeof GenerateIntelligenceBodySchema>;
  }>('/pots/:potId/intelligence/generate', async (request, reply) => {
    const { potId } = request.params;

    // Validate body
    const bodyValidation = GenerateIntelligenceBodySchema.safeParse(request.body);
    if (!bodyValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: bodyValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }
    const { mode: requestedMode, model_id: modelIdOverride, custom_prompt, max_questions } = bodyValidation.data;

    // Check pot exists
    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Load entries to estimate token count and build snapshot hash
    const entries = await listEntries({ pot_id: potId, limit: 500 });
    const validEntries = entries.filter(
      (e) => e.type !== 'link' && (e.content_text && e.content_text.length > 20 || e.type === 'image' || e.type === 'audio')
    );

    if (validEntries.length < 2) {
      return reply.status(422).send({
        error: 'InsufficientContentError',
        message: 'Pot needs at least 2 entries (text, images, or audio) with content to generate intelligence.',
        statusCode: 422,
        request_id: request.id,
      });
    }

    // Build pot snapshot hash
    const potSnapshotHash = buildPotSnapshotHash(validEntries);

    // Get model context length
    const prefs = await getAIPreferences();
    const modelId = modelIdOverride ?? prefs.task_models?.summarization ?? prefs.task_models?.linking ?? prefs.default_model ?? 'x-ai/grok-4.1-fast';

    // Rough token estimate (digest mode: ~500 chars per entry; full mode: all content)
    const digestEstimate = validEntries.length * 500;
    const fullEstimate = validEntries.reduce((sum, e) => sum + estimateTokens(e.content_text ?? ''), 0);

    // Decide mode
    const CONTEXT_LENGTH = 32000; // conservative default; real context_length loaded from model registry if available
    let mode: 'full' | 'digest';
    let estimatedTokens: number;
    let modeMessage: string | undefined;

    if (requestedMode === 'full') {
      mode = 'full';
      estimatedTokens = fullEstimate;
      if (fullEstimate > CONTEXT_LENGTH * 0.75) {
        modeMessage = `Full mode exceeds 75% of context window (estimated ${fullEstimate} tokens). Consider using 'digest' mode.`;
      }
    } else if (requestedMode === 'digest') {
      mode = 'digest';
      estimatedTokens = digestEstimate;
    } else {
      // auto: choose based on size
      if (fullEstimate <= CONTEXT_LENGTH * 0.6) {
        mode = 'full';
        estimatedTokens = fullEstimate;
      } else {
        mode = 'digest';
        estimatedTokens = digestEstimate;
        if (fullEstimate > CONTEXT_LENGTH * 0.6) {
          modeMessage = `Switched to digest mode (full pot estimated ${fullEstimate} tokens, exceeds 60% of context window).`;
        }
      }
    }

    // Hard fail if even digest is too big
    if (mode === 'digest' && estimatedTokens > CONTEXT_LENGTH * 0.9) {
      return reply.status(422).send({
        error: 'ContextWindowExceededError',
        message: `Pot is too large even in digest mode (estimated ${estimatedTokens} tokens). Select a larger-context model.`,
        statusCode: 422,
        request_id: request.id,
      });
    }

    // Create the run record
    const run = await insertIntelligenceRun({
      pot_id: potId,
      mode,
      model_id: modelId,
      prompt_version: '1',
      pot_snapshot_hash: potSnapshotHash,
      estimated_input_tokens: estimatedTokens,
      context_length: CONTEXT_LENGTH,
      custom_prompt,
      max_questions,
    });

    // Enqueue the question generation job
    const job = await enqueueJob({
      job_type: 'intel_generate_questions',
      pot_id: potId,
      priority: 5,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'intel_run_triggered',
      pot_id: potId,
      metadata: {
        run_id: run.id,
        job_id: job.id,
        mode,
        model_id: modelId,
        estimated_tokens: estimatedTokens,
        entry_count: validEntries.length,
      },
    });

    logger.info(
      { run_id: run.id, job_id: job.id, pot_id: potId, mode, estimated_tokens: estimatedTokens },
      'Intel gen run triggered'
    );

    return reply.status(202).send({
      run_id: run.id,
      job_id: job.id,
      mode,
      model_id: modelId,
      context_length: CONTEXT_LENGTH,
      estimated_input_tokens: estimatedTokens,
      entry_count: validEntries.length,
      message: modeMessage ?? `Intel generation queued in ${mode} mode.`,
    });
  });

  /**
   * GET /pots/:potId/intelligence/runs
   * List all runs for a pot.
   */
  fastify.get<{ Params: { potId: string } }>(
    '/pots/:potId/intelligence/runs',
    async (request, reply) => {
      const { potId } = request.params;
      const pot = await getPotById(potId);
      if (!pot) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: `Pot not found: ${potId}`,
          statusCode: 404,
          request_id: request.id,
        });
      }

      const runs = await listIntelligenceRunsForPot(potId);
      return reply.send({ runs });
    }
  );

  /**
   * GET /pots/:potId/intelligence/questions
   * List questions, optionally filtered by run_id.
   */
  fastify.get<{
    Params: { potId: string };
    Querystring: z.infer<typeof ListQuestionsQuerySchema>;
  }>('/pots/:potId/intelligence/questions', async (request, reply) => {
    const { potId } = request.params;
    const queryValidation = ListQuestionsQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: queryValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }
    const { run_id, limit } = queryValidation.data;

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    if (run_id) {
      const run = await getIntelligenceRunById(run_id);
      if (!run || run.pot_id !== potId) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: `Run not found for this pot: ${run_id}`,
          statusCode: 404,
          request_id: request.id,
        });
      }
    }

    const questions = run_id
      ? await listIntelligenceQuestionsForRun(run_id)
      : await listIntelligenceQuestionsForPot(potId, limit);

    return reply.send({ questions });
  });

  /**
   * GET /pots/:potId/intelligence/questions/:questionId
   * Get a single question with its answer (if available).
   */
  fastify.get<{
    Params: { potId: string; questionId: string };
  }>('/pots/:potId/intelligence/questions/:questionId', async (request, reply) => {
    const { questionId } = request.params;

    const question = await getIntelligenceQuestionById(questionId);
    if (!question) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Question not found: ${questionId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    const answer = await getIntelligenceAnswerByQuestionId(questionId);
    return reply.send({ question, answer: answer ?? null });
  });

  /**
   * GET /pots/:potId/intelligence/answers
   * List answers, optionally filtered by question_id.
   */
  fastify.get<{
    Params: { potId: string };
    Querystring: z.infer<typeof ListAnswersQuerySchema>;
  }>('/pots/:potId/intelligence/answers', async (request, reply) => {
    const { potId } = request.params;
    const queryValidation = ListAnswersQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: queryValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }
    const { question_id, limit } = queryValidation.data;

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    const answers = question_id
      ? await (async () => {
          const a = await getIntelligenceAnswerByQuestionId(question_id);
          return a ? [a] : [];
        })()
      : await listIntelligenceAnswersForPot(potId, limit);

    return reply.send({ answers });
  });

  /**
   * POST /pots/:potId/intelligence/answers/:answerId/promote
   * Promote an answer to a derived artifact (for inclusion in processed output).
   */
  fastify.post<{
    Params: { potId: string; answerId: string };
    Body: z.infer<typeof PromoteAnswerBodySchema>;
  }>('/pots/:potId/intelligence/answers/:answerId/promote', async (request, reply) => {
    const { potId, answerId } = request.params;

    const bodyValidation = PromoteAnswerBodySchema.safeParse(request.body ?? {});
    if (!bodyValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: bodyValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    const answer = await getIntelligenceAnswerById(answerId);
    if (!answer || answer.pot_id !== potId) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Answer not found: ${answerId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    const question = await getIntelligenceQuestionById(answer.question_id);

    // Build the promoted artifact payload
    const promotedPayload = {
      source: 'generated_intelligence',
      answer_id: answerId,
      question_id: answer.question_id,
      question_text: question?.question_text ?? null,
      answer_text: answer.answer_text,
      confidence: answer.confidence,
      evidence: answer.evidence,
      excerpt_validation: answer.excerpt_validation,
      limits_text: answer.limits_text,
      model_id: answer.model_id,
      prompt_version: answer.prompt_version,
      entry_ids: question?.entry_ids ?? [],
    };

    // Store as a derived artifact on the first referenced entry
    const firstEntryId = question?.entry_ids?.[0] ?? null;
    if (!firstEntryId) {
      return reply.status(422).send({
        error: 'PromotionError',
        message: 'Cannot promote answer: no referenced entries found.',
        statusCode: 422,
        request_id: request.id,
      });
    }

    const artifact = await insertArtifact(
      {
        pot_id: potId,
        entry_id: firstEntryId,
        artifact_type: 'summary', // stored as summary type for UI compatibility
        schema_version: 1,
        model_id: answer.model_id,
        prompt_id: answer.prompt_id,
        prompt_version: `${answer.prompt_version}+promoted`,
        temperature: answer.temperature,
        payload: promotedPayload,
        evidence: answer.evidence,
      },
      true // force: promote is explicit user action
    );

    await logAuditEvent({
      actor: 'user',
      action: 'intel_answer_promoted',
      pot_id: potId,
      entry_id: firstEntryId,
      metadata: {
        answer_id: answerId,
        question_id: answer.question_id,
        artifact_id: artifact?.id ?? null,
      },
    });

    logger.info(
      { answer_id: answerId, artifact_id: artifact?.id, pot_id: potId },
      'Intel answer promoted to artifact'
    );

    return reply.status(201).send({
      promoted: true,
      artifact_id: artifact?.id ?? null,
      answer_id: answerId,
      entry_id: firstEntryId,
    });
  });

  /**
   * POST /intelligence/improve-prompt
   * Use AI to improve a user-supplied research focus / custom prompt.
   * Takes a rough draft and returns a cleaner, more specific version.
   */
  fastify.post<{
    Body: z.infer<typeof ImprovePromptBodySchema>;
  }>('/intelligence/improve-prompt', async (request, reply) => {
    const bodyValidation = ImprovePromptBodySchema.safeParse(request.body);
    if (!bodyValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: bodyValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }
    const { draft } = bodyValidation.data;

    const prefs = await getAIPreferences();
    const model = prefs.default_model ?? 'x-ai/grok-4.1-fast';

    const systemPrompt = `You are a research prompt specialist. A user wants to guide an AI research analyst to focus on specific topics and perspectives when analyzing a collection of research documents.

Rewrite the user's draft research focus instruction to be clearer, more specific, and more actionable. The improved version should help the AI analyst:
1. Understand the user's domain or perspective (e.g., security engineer, medical professional, legal analyst, investor)
2. Know what types of questions and connections to prioritize
3. Understand what patterns, risks, or insights are most valuable to surface

Rules:
- Keep the improved instruction focused and concrete — avoid vague language
- Preserve the user's original intent; only clarify and strengthen it
- Maximum 400 words
- Return ONLY the improved instruction text, with no preamble, explanation, or surrounding quotes`;

    const userMessage = `Improve this research focus instruction:\n\n${draft}`;

    try {
      const response = await createChatCompletion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 600,
      });

      const improved = response.choices[0]?.message?.content?.trim() ?? draft;
      logger.info({ model, draft_length: draft.length, improved_length: improved.length }, 'Prompt improved');

      return reply.send({ improved });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'improve-prompt AI call failed');
      return reply.status(500).send({
        error: 'AIError',
        message: `Failed to improve prompt: ${msg}`,
        statusCode: 500,
        request_id: request.id,
      });
    }
  });
};
