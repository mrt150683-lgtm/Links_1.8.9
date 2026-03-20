/**
 * mom_merge worker job
 *
 * Final stage of the worker-backed MoM pipeline.
 * Reads all agent outputs and review findings from DB, runs the merge
 * model, stores the final output, updates the placeholder assistant
 * message with the final answer, and marks the run as done.
 *
 * Payload: MomJobPayload (from momPlan.ts)
 */

import { createChatCompletion } from '@links/ai';
import {
  getChatRun,
  updateChatRunStatus,
  updateChatRunFinalOutput,
  listChatRunAgents,
  listChatRunReviews,
  insertChatRunEvent,
  updateChatMessageContent,
  updateMainChatMessageContent,
} from '@links/storage';
import type { JobContext } from '@links/storage';
import {
  MomMergeOutputSchema,
  type MomPlannerOutput,
  type MomAgentOutput,
  type MomReviewOutput,
} from '@links/core';
import { createLogger } from '@links/logging';
import type { MomJobPayload } from './momPlan.js';
import { extractJson } from './momPlan.js';

const logger = createLogger({ name: 'mom-merge' });

export async function momMergeHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as MomJobPayload;
  const { chat_run_id, user_message, merge_model_id, surface, assistant_message_id } = payload;

  // Guard: check if cancelled
  const run = await getChatRun(chat_run_id);
  if (!run) throw new Error(`chat_run not found: ${chat_run_id}`);
  if (run.status === 'cancelled') {
    logger.info({ chat_run_id }, 'mom_merge skipped — run cancelled');
    return;
  }

  await updateChatRunStatus(chat_run_id, 'merging');

  // Load agents + reviews
  const agents = await listChatRunAgents(chat_run_id);
  const succeededAgents = agents.filter((a) => a.status === 'done' && a.output);
  const reviews = await listChatRunReviews(chat_run_id);

  if (succeededAgents.length < 2) {
    const errMsg = `Merge failed: only ${succeededAgents.length} agent(s) succeeded`;
    await updateChatRunStatus(chat_run_id, 'failed', { error_message: errMsg });
    const errContent = `[MoM ${payload.target_mode} analysis failed: insufficient agent results. Please try again.]`;
    if (surface === 'pot') await updateChatMessageContent(assistant_message_id, errContent).catch(() => {});
    else await updateMainChatMessageContent(assistant_message_id, errContent).catch(() => {});
    return;
  }

  // Build merge input
  const plannerOutput = run.planner_output as MomPlannerOutput | null;

  const agentOutputsText = succeededAgents
    .map((agent, i) => {
      const agentOut = agent.output as unknown as MomAgentOutput;
      const review = reviews.find((r) => r.target_agent_id === agent.id);
      const reviewOut = review?.review_output as MomReviewOutput | null;

      const reviewBlock = reviewOut
        ? `\n**Review (${reviewOut.verdict}):** ${reviewOut.notes}` +
          (reviewOut.challenged_claims.length > 0 ? `\nChallenged: ${reviewOut.challenged_claims.join('; ')}` : '') +
          (reviewOut.fabrications.length > 0 ? `\nFabrications: ${reviewOut.fabrications.join('; ')}` : '')
        : '';

      return `### Agent ${i + 1}: ${agent.agent_role}\n${JSON.stringify(agentOut, null, 2)}${reviewBlock}`;
    })
    .join('\n\n');

  const plannerSummary = plannerOutput
    ? `strategy: ${plannerOutput.decomposition_strategy}\nreason: ${plannerOutput.reason}\nagent_count: ${succeededAgents.length}`
    : `agent_count: ${succeededAgents.length}`;

  const systemPrompt = `You are a synthesis model in a Mixture of Models orchestration. Receive specialist agent outputs and produce a final coherent answer. Preserve honest disagreements. Reject unsupported claims.

Output ONLY valid JSON — no markdown, no explanation:
{
  "final_answer": "<full final answer in markdown>",
  "consensus_points": ["<agreed point>"],
  "disagreements": ["<genuine disagreement>"],
  "rejected_claims": ["<claim without evidence>"],
  "missing_context": ["<unresolved gap>"],
  "confidence": <0.0-1.0>,
  "trace_summary": "<brief trace summary under 150 words>"
}`;

  const userContent = `## Question\n${user_message}\n\n## Planner Decision\n${plannerSummary}\n\n## Specialist Outputs\n${agentOutputsText}`;

  await insertChatRunEvent(chat_run_id, 'MERGE_STARTED', { agent_count: succeededAgents.length });

  let finalAnswer: string;
  let mergeOutput: Record<string, unknown>;

  try {
    const mergeResponse = await createChatCompletion({
      model: merge_model_id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ] as any,
      temperature: 0.3,
      max_tokens: 2500,
    }, 120000);

    const mergeRaw = mergeResponse.choices?.[0]?.message?.content ?? '';
    const parsed = MomMergeOutputSchema.parse(JSON.parse(extractJson(mergeRaw)));
    mergeOutput = parsed as unknown as Record<string, unknown>;
    finalAnswer = parsed.final_answer;

    logger.info({ chat_run_id, confidence: parsed.confidence }, 'Merge completed');

  } catch (err) {
    // Fallback: use the best-confidence agent answer
    logger.warn({ chat_run_id, err }, 'Merge failed — using best agent answer');
    const bestAgent = succeededAgents.reduce((best, cur) => {
      const bConf = (best.output as any)?.confidence ?? 0;
      const cConf = (cur.output as any)?.confidence ?? 0;
      return cConf > bConf ? cur : best;
    });
    const bestOut = bestAgent.output as unknown as MomAgentOutput;
    finalAnswer = bestOut.answer;
    mergeOutput = {
      final_answer: finalAnswer,
      consensus_points: [],
      disagreements: [],
      rejected_claims: [],
      missing_context: [],
      confidence: bestOut.confidence,
      trace_summary: `Merge failed; using best agent: ${bestAgent.agent_role}`,
    };
  }

  // ── Persist ────────────────────────────────────────────────────────
  await updateChatRunFinalOutput(chat_run_id, mergeOutput, merge_model_id);
  await insertChatRunEvent(chat_run_id, 'MERGE_COMPLETED', { confidence: (mergeOutput as any).confidence });

  // ── Update placeholder message ─────────────────────────────────────
  try {
    if (surface === 'pot') {
      await updateChatMessageContent(assistant_message_id, finalAnswer);
    } else {
      await updateMainChatMessageContent(assistant_message_id, finalAnswer);
    }
  } catch (msgErr) {
    logger.warn({ chat_run_id, err: msgErr }, 'Failed to update assistant message — final answer stored in chat_run');
  }

  logger.info({ chat_run_id, surface }, 'mom_merge done — run complete');
}
