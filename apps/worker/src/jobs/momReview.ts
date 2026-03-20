/**
 * mom_review worker job
 *
 * Optional third stage of the worker-backed MoM pipeline.
 * Only enqueued when planner set review_required=true.
 * Reads agent outputs from DB, runs a reviewer for each sequentially,
 * stores results in chat_run_reviews, then enqueues mom_merge.
 *
 * Payload: MomJobPayload (from momPlan.ts)
 */

import { createChatCompletion } from '@links/ai';
import {
  getChatRun,
  listChatRunAgents,
  createChatRunReview,
  updateChatRunReview,
  insertChatRunEvent,
  enqueueJob,
} from '@links/storage';
import type { JobContext } from '@links/storage';
import {
  MomReviewOutputSchema,
  type MomAgentOutput,
} from '@links/core';
import { createLogger } from '@links/logging';
import type { MomJobPayload } from './momPlan.js';
import { extractJson } from './momPlan.js';

const logger = createLogger({ name: 'mom-review' });

export async function momReviewHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as MomJobPayload;
  const { chat_run_id, user_message, specialist_model_id } = payload;

  // Guard: check if cancelled
  const run = await getChatRun(chat_run_id);
  if (!run) throw new Error(`chat_run not found: ${chat_run_id}`);
  if (run.status === 'cancelled') {
    logger.info({ chat_run_id }, 'mom_review skipped — run cancelled');
    return;
  }

  // Load completed agents
  const agents = await listChatRunAgents(chat_run_id);
  const succeededAgents = agents.filter((a) => a.status === 'done' && a.output);

  await insertChatRunEvent(chat_run_id, 'REVIEW_STARTED', { agent_count: succeededAgents.length });

  const systemPrompt = `You are a critical review model in a Mixture of Models orchestration. You receive the output of a specialist agent and evaluate it for accuracy, logical consistency, and completeness. Flag unsupported claims and surface what was missed.

Output ONLY valid JSON — no markdown, no explanation:
{
  "target_agent_role": "<agent role string>",
  "verdict": "accept|partial|reject",
  "supported_claims": ["<claim confirmed>"],
  "challenged_claims": ["<claim needing qualification>"],
  "fabrications": ["<claim not supported>"],
  "missing_perspectives": ["<angle the agent missed>"],
  "suggested_additions": ["<concrete improvement>"],
  "confidence_delta": <-1.0 to 1.0>,
  "notes": "<overall assessment under 100 words>"
}`;

  // Sequential reviews
  let reviewedCount = 0;

  for (const agent of succeededAgents) {
    // Check cancellation between reviews
    const runNow = await getChatRun(chat_run_id);
    if (runNow?.status === 'cancelled') {
      logger.info({ chat_run_id }, 'mom_review: cancelled mid-run');
      return;
    }

    const reviewRow = await createChatRunReview({
      chat_run_id,
      target_agent_id: agent.id,
      model_id: specialist_model_id,
    });

    const startedAt = Date.now();
    const agentOutput = agent.output as unknown as MomAgentOutput;

    const userContent = `## Agent Output to Review\n${JSON.stringify(agentOutput, null, 2)}\n\n## Original Question\n${user_message}`;

    try {
      const response = await createChatCompletion({
        model: specialist_model_id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ] as any,
        temperature: 0.1,
        max_tokens: 800,
      }, 60000);

      const latencyMs = Date.now() - startedAt;
      const raw = response.choices?.[0]?.message?.content ?? '';
      const reviewOutput = MomReviewOutputSchema.parse(JSON.parse(extractJson(raw)));

      const tokenUsage = response.usage
        ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens }
        : undefined;

      await updateChatRunReview(reviewRow.id, {
        review_output: reviewOutput as unknown as Record<string, unknown>,
        latency_ms: latencyMs,
        ...(tokenUsage ? { token_usage: tokenUsage } : {}),
      });

      reviewedCount++;
      logger.info({ chat_run_id, role: agent.agent_role, verdict: reviewOutput.verdict }, 'Review completed');

    } catch (err) {
      logger.warn({ chat_run_id, agent_role: agent.agent_role, err }, 'Review failed — continuing');
    }
  }

  await insertChatRunEvent(chat_run_id, 'REVIEW_COMPLETED', { reviewed: reviewedCount, total: succeededAgents.length });

  // Enqueue merge
  await enqueueJob({
    job_type: 'mom_merge',
    pot_id: payload.pot_id,
    payload,
    priority: 5,
  });

  logger.info({ chat_run_id }, 'mom_review done — enqueueing mom_merge');
}
