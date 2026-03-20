/**
 * mom_run_agents worker job
 *
 * Second stage of the worker-backed MoM pipeline.
 * Reads the planner output from DB, runs specialist agents sequentially
 * (to avoid rate-limit issues in background mode), stores each output,
 * then enqueues mom_review (if review_required) or mom_merge.
 *
 * Payload: MomJobPayload (from momPlan.ts)
 */

import { createChatCompletion } from '@links/ai';
import {
  getChatRun,
  updateChatRunStatus,
  createChatRunAgent,
  updateChatRunAgent,
  insertChatRunEvent,
  enqueueJob,
  updateChatMessageContent,
  updateMainChatMessageContent,
} from '@links/storage';
import type { JobContext } from '@links/storage';
import {
  MomAgentOutputSchema,
  MomPlannerOutputSchema,
  type MomPlannerOutput,
  type MomAgentOutput,
} from '@links/core';
import { createLogger } from '@links/logging';
import type { MomJobPayload } from './momPlan.js';
import { extractJson } from './momPlan.js';

const logger = createLogger({ name: 'mom-run-agents' });

const QUORUM = 2;

export async function momRunAgentsHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as MomJobPayload;
  const { chat_run_id, user_message, specialist_model_id, surface, assistant_message_id } = payload;

  // Guard: check if cancelled
  const run = await getChatRun(chat_run_id);
  if (!run) throw new Error(`chat_run not found: ${chat_run_id}`);
  if (run.status === 'cancelled') {
    logger.info({ chat_run_id }, 'mom_run_agents skipped — run cancelled');
    return;
  }

  // Load planner output from DB
  const plannerOutput = run.planner_output as MomPlannerOutput | null;
  if (!plannerOutput) {
    throw new Error(`mom_run_agents: no planner_output found for run ${chat_run_id}`);
  }

  // Validate planner output shape
  const parsed = MomPlannerOutputSchema.safeParse(plannerOutput);
  if (!parsed.success) throw new Error(`mom_run_agents: invalid planner output: ${parsed.error.message}`);

  const agentRoles = parsed.data.agent_roles.slice(0, parsed.data.recommended_agent_count);
  const agentCount = agentRoles.length;

  await updateChatRunStatus(chat_run_id, 'running');
  await insertChatRunEvent(chat_run_id, 'AGENTS_DISPATCHED', { count: agentCount });

  // Build context text (simplified for background jobs — no dynamic assembly)
  const agentContextNote = `[Background MoM run — ${payload.target_mode}. Use the question and your general knowledge.]`;

  // ── Sequential agent execution ────────────────────────────────────
  let successCount = 0;

  for (let idx = 0; idx < agentRoles.length; idx++) {
    const roleSpec = agentRoles[idx]!;

    // Check cancellation between agents
    const runNow = await getChatRun(chat_run_id);
    if (runNow?.status === 'cancelled') {
      logger.info({ chat_run_id }, 'mom_run_agents: cancelled mid-run');
      return;
    }

    const agentRow = await createChatRunAgent({
      chat_run_id,
      agent_index: idx,
      agent_role: roleSpec.role,
      model_id: specialist_model_id,
    });

    const startedAt = Date.now();
    await updateChatRunAgent(agentRow.id, { status: 'running' });

    const userContent = `## Your Role\n${roleSpec.role}: ${roleSpec.focus}\n\n## Question\n${user_message}\n\n## Context\n${agentContextNote}`;

    const systemPrompt = `You are a specialist AI agent in a Mixture of Models orchestration. You have been assigned a specific analytical role. Use your knowledge carefully. Be evidence-based and acknowledge uncertainty.

Output ONLY valid JSON — no markdown, no explanation:
{
  "role": "<your assigned role>",
  "summary": "<one-sentence summary>",
  "answer": "<full answer in markdown>",
  "claims": ["<claim>"],
  "assumptions": ["<assumption>"],
  "evidence_refs": ["<verbatim excerpt or source reference>"],
  "missing_context": ["<what is missing>"],
  "risks": ["<risk or caveat>"],
  "confidence": <0.0-1.0>
}`;

    try {
      const response = await createChatCompletion({
        model: specialist_model_id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ] as any,
        temperature: 0.2,
        max_tokens: 1500,
      }, 90000);

      const latencyMs = Date.now() - startedAt;
      const raw = response.choices?.[0]?.message?.content ?? '';
      const agentOutput: MomAgentOutput = MomAgentOutputSchema.parse(JSON.parse(extractJson(raw)));

      const tokenUsage = response.usage
        ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens }
        : undefined;

      await updateChatRunAgent(agentRow.id, {
        status: 'done',
        output: agentOutput as unknown as Record<string, unknown>,
        latency_ms: latencyMs,
        ...(tokenUsage ? { token_usage: tokenUsage } : {}),
      });

      successCount++;
      logger.info({ chat_run_id, role: roleSpec.role, latencyMs, confidence: agentOutput.confidence }, 'Agent completed');

    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errMsg = err instanceof Error ? err.message : String(err);
      await updateChatRunAgent(agentRow.id, {
        status: 'failed',
        error_message: errMsg.slice(0, 500),
        latency_ms: latencyMs,
      });
      logger.warn({ chat_run_id, role: roleSpec.role, err }, 'Agent failed — continuing');
    }
  }

  await insertChatRunEvent(chat_run_id, 'AGENTS_COMPLETED', { succeeded: successCount, total: agentCount });

  // ── Quorum check ──────────────────────────────────────────────────
  if (successCount < QUORUM) {
    logger.error({ chat_run_id, successCount, agentCount }, 'Quorum failed');
    await updateChatRunStatus(chat_run_id, 'failed', { error_message: `Quorum failed: only ${successCount}/${agentCount} agents succeeded` });
    const errContent = `[MoM ${payload.target_mode} analysis failed: insufficient agent results. Please try again.]`;
    if (surface === 'pot') await updateChatMessageContent(assistant_message_id, errContent).catch(() => {});
    else await updateMainChatMessageContent(assistant_message_id, errContent).catch(() => {});
    return;
  }

  // Enqueue next stage
  const nextJobType = parsed.data.review_required ? 'mom_review' : 'mom_merge';
  await enqueueJob({
    job_type: nextJobType,
    pot_id: payload.pot_id,
    payload,
    priority: 5,
  });

  logger.info({ chat_run_id, nextJobType }, `mom_run_agents done — enqueueing ${nextJobType}`);
}
