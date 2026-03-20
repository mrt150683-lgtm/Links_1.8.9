/**
 * mom_plan worker job
 *
 * First stage of the worker-backed MoM Standard/Heavy pipeline.
 * Runs the planner model to decide how many agents to use and what
 * roles they should play, then enqueues mom_run_agents.
 *
 * Payload: MomJobPayload
 */

import { createChatCompletion } from '@links/ai';
import {
  getChatRun,
  updateChatRunStatus,
  updateChatRunPlanner,
  insertChatRunEvent,
  enqueueJob,
  updateChatMessageContent,
  updateMainChatMessageContent,
} from '@links/storage';
import type { JobContext } from '@links/storage';
import {
  MomPlannerOutputSchema,
  type MomPlannerOutput,
} from '@links/core';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'mom-plan' });

/**
 * Strip markdown code fences from AI output before JSON.parse.
 * Some models wrap JSON in ```json ... ``` even when instructed not to.
 */
export function extractJson(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '').trim();
}

export interface MomJobPayload {
  chat_run_id: string;
  thread_id: string;
  assistant_message_id: string;
  surface: 'pot' | 'main';
  user_message: string;
  pot_id?: string;
  planner_model_id: string;
  specialist_model_id: string;
  merge_model_id: string;
  target_mode: 'mom_standard' | 'mom_heavy';
}

export async function momPlanHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as MomJobPayload;
  const { chat_run_id, user_message, planner_model_id, target_mode, assistant_message_id, surface } = payload;

  // Guard: check if cancelled
  const run = await getChatRun(chat_run_id);
  if (!run) throw new Error(`chat_run not found: ${chat_run_id}`);
  if (run.status === 'cancelled') {
    logger.info({ chat_run_id }, 'mom_plan skipped — run cancelled');
    return;
  }

  await updateChatRunStatus(chat_run_id, 'planning');

  // ── Build planner prompt ──────────────────────────────────────────
  const modeInstructions = target_mode === 'mom_heavy'
    ? 'For mom_heavy: use recommended_agent_count=6, review_required=true (mandatory), execution_mode="mom_heavy".'
    : 'For mom_standard: use recommended_agent_count=4, review_required=true, execution_mode="mom_standard".';

  const systemPrompt = `You are a planning model for a Mixture of Models (MoM) chat orchestration system. Your ONLY job is to analyse the user's question and output a JSON routing decision.

Do NOT answer the user's question. Output ONLY valid JSON matching this schema — no markdown, no explanation:
{
  "should_use_mom": true,
  "execution_mode": "${target_mode}",
  "recommended_agent_count": <integer>,
  "agent_roles": [
    { "role": "<name>", "description": "<what this agent does>", "focus": "<specific analytical angle>" }
  ],
  "decomposition_strategy": "<how the question is split across agents>",
  "review_required": <boolean>,
  "merge_model_id": null,
  "background_recommended": true,
  "reason": "<one short phrase>"
}

${modeInstructions}
Always set should_use_mom=true for this call — the user has already selected the mode.`;

  let plannerOutput: MomPlannerOutput;
  try {
    const response = await createChatCompletion({
      model: planner_model_id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `User question: "${user_message}"` },
      ] as any,
      temperature: 0.1,
      max_tokens: 500,
    }, 30000);

    const raw = response.choices?.[0]?.message?.content ?? '';
    plannerOutput = MomPlannerOutputSchema.parse(JSON.parse(extractJson(raw)));
  } catch (err) {
    logger.error({ chat_run_id, err }, 'mom_plan: planner failed');
    await updateChatRunStatus(chat_run_id, 'failed', { error_message: `Planner failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) });
    // Update placeholder to error message (include the reason so user can diagnose)
    const reason = err instanceof Error ? err.message : String(err);
    const errContent = `**MoM ${target_mode} failed during planning.**\n\nModel: \`${planner_model_id}\`\nError: ${reason.slice(0, 300)}\n\n_Try a different model in Chat Settings → MoM Models, or switch to Single mode._`;
    if (surface === 'pot') await updateChatMessageContent(assistant_message_id, errContent).catch(() => {});
    else await updateMainChatMessageContent(assistant_message_id, errContent).catch(() => {});
    return; // Don't throw — job is done (failed gracefully)
  }

  await updateChatRunPlanner(chat_run_id, plannerOutput as unknown as Record<string, unknown>, planner_model_id);
  await insertChatRunEvent(chat_run_id, 'PLANNER_DONE', {
    agent_count: plannerOutput.recommended_agent_count,
    review_required: plannerOutput.review_required,
    execution_mode: plannerOutput.execution_mode,
  });

  logger.info({ chat_run_id, agent_count: plannerOutput.recommended_agent_count, review_required: plannerOutput.review_required }, 'mom_plan completed — enqueueing mom_run_agents');

  // Enqueue next stage
  await enqueueJob({
    job_type: 'mom_run_agents',
    pot_id: payload.pot_id,
    payload,
    priority: 5,
  });
}
