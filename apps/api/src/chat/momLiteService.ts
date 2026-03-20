/**
 * MoM Lite Service
 *
 * Synchronous Mixture-of-Models orchestration for the 'mom_lite' execution mode.
 * Runs N specialist agents in parallel (Promise.all), then runs a merge model
 * to produce a single final answer. No cross-review (Phase 2 adds that).
 *
 * Failure handling:
 * - If the planner fails: caller falls back to single-model path
 * - If quorum fails (fewer than 2 agents succeed): throw → caller falls back
 */

import { createChatCompletion } from '@links/ai';
import type { AiPreferences } from '@links/storage';
import {
  updateChatRunStatus,
  updateChatRunPlanner,
  updateChatRunFinalOutput,
  createChatRunAgent,
  updateChatRunAgent,
  insertChatRunEvent,
  createChatRunReview,
  updateChatRunReview,
} from '@links/storage';
import {
  MomPlannerOutputSchema,
  MomAgentOutputSchema,
  MomMergeOutputSchema,
  MomReviewOutputSchema,
  type MomPlannerOutput,
  type MomAgentOutput,
  type MomReviewOutput,
} from '@links/core';
import { createLogger } from '@links/logging';
import type { ChatContext } from './contextAssembler.js';
import { buildContextStats } from './contextAssembler.js';

const logger = createLogger({ name: 'mom-lite' });

// ── Helpers ──────────────────────────────────────────────────────────

const PLANNER_PROMPT_ID = 'chat_mom_planner';
const AGENT_PROMPT_ID = 'chat_mom_agent_answer';
const REVIEW_PROMPT_ID = 'chat_mom_agent_review';
const MERGE_PROMPT_ID = 'chat_mom_merge';

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ── Run MoM Planner ──────────────────────────────────────────────────

export async function runMomPlanner(opts: {
  userMessage: string;
  context: ChatContext;
  plannerModelId: string;
  prefs: AiPreferences;
}): Promise<MomPlannerOutput> {
  const { userMessage, context, plannerModelId } = opts;

  const contextStats = buildContextStats(context);

  const userContent = fillTemplate(
    `User message: "{{user_message}}"\n\nContext stats:\n{{context_stats}}`,
    { user_message: userMessage, context_stats: contextStats },
  );

  const response = await createChatCompletion({
    model: plannerModelId,
    messages: [
      { role: 'system', content: buildPlannerSystemPrompt() },
      { role: 'user', content: userContent },
    ] as any,
    temperature: 0.1,
    max_tokens: 400,
  }, 30000);

  const raw = response.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(raw);
  return MomPlannerOutputSchema.parse(parsed);
}

function buildPlannerSystemPrompt(): string {
  return `You are a planning model for a Mixture of Models (MoM) chat orchestration system. Your ONLY job is to analyse the user's question and the chat context, then output a JSON routing decision.

Do NOT answer the user's question. Output ONLY valid JSON matching this schema — no markdown, no explanation:
{
  "should_use_mom": <boolean>,
  "execution_mode": "single|mom_lite|mom_standard|mom_heavy",
  "recommended_agent_count": <integer 1-8>,
  "agent_roles": [
    { "role": "<name>", "description": "<what this agent does>", "focus": "<specific analytical angle>" }
  ],
  "decomposition_strategy": "<how the question is split across agents>",
  "review_required": false,
  "merge_model_id": null,
  "background_recommended": false,
  "reason": "<one short phrase>"
}

For mom_lite: set review_required=false, background_recommended=false, recommended_agent_count=2 or 3.
Default to should_use_mom=false, execution_mode="single" for simple/conversational questions.`;
}

// ── Run MoM Lite ─────────────────────────────────────────────────────

export async function runMomLite(opts: {
  chatRunId: string;
  userMessage: string;
  context: ChatContext;
  plannerOutput: MomPlannerOutput;
  specialistModelId: string;
  mergeModelId: string;
  prefs: AiPreferences;
}): Promise<string> {
  const {
    chatRunId,
    userMessage,
    context,
    plannerOutput,
    specialistModelId,
    mergeModelId,
  } = opts;

  const agentRoles = plannerOutput.agent_roles.slice(0, plannerOutput.recommended_agent_count);
  const agentCount = agentRoles.length;

  await updateChatRunStatus(chatRunId, 'running');
  await insertChatRunEvent(chatRunId, 'AGENTS_DISPATCHED', { count: agentCount });

  // Create agent rows
  const agentRows = await Promise.all(
    agentRoles.map((roleSpec, idx) =>
      createChatRunAgent({
        chat_run_id: chatRunId,
        agent_index: idx,
        agent_role: roleSpec.role,
        model_id: specialistModelId,
      }),
    ),
  );

  // ── Parallel agent execution ─────────────────────────────────────
  const agentContext = buildAgentContext(context);

  const agentResults = await Promise.allSettled(
    agentRoles.map(async (roleSpec, idx) => {
      const agentRow = agentRows[idx]!;
      const startedAt = Date.now();

      await updateChatRunAgent(agentRow.id, { status: 'running' });

      const userContent = buildAgentUserContent({
        agentRole: roleSpec.role,
        agentFocus: roleSpec.focus,
        userMessage,
        context: agentContext,
      });

      let output: MomAgentOutput;
      let latencyMs: number;
      let tokenUsage: Record<string, unknown> | undefined;

      try {
        const response = await createChatCompletion({
          model: specialistModelId,
          messages: [
            { role: 'system', content: buildAgentSystemPrompt() },
            { role: 'user', content: userContent },
          ] as any,
          temperature: 0.2,
          max_tokens: 1200,
        }, 60000);

        latencyMs = Date.now() - startedAt;
        const raw = response.choices?.[0]?.message?.content ?? '';
        const parsed = JSON.parse(raw);
        output = MomAgentOutputSchema.parse(parsed);

        if (response.usage) {
          tokenUsage = {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          };
        }

        await updateChatRunAgent(agentRow.id, {
          status: 'done',
          output: output as unknown as Record<string, unknown>,
          latency_ms: latencyMs,
          ...(tokenUsage ? { token_usage: tokenUsage } : {}),
        });

        logger.info({ chatRunId, role: roleSpec.role, latencyMs, confidence: output.confidence }, 'MoM agent completed');
        return output;

      } catch (err) {
        latencyMs = Date.now() - startedAt;
        const errMsg = err instanceof Error ? err.message : String(err);
        await updateChatRunAgent(agentRow.id, {
          status: 'failed',
          error_message: errMsg.slice(0, 500),
          latency_ms: latencyMs,
        });
        logger.warn({ chatRunId, role: roleSpec.role, err }, 'MoM agent failed');
        throw err;
      }
    }),
  );

  // ── Quorum check ──────────────────────────────────────────────────
  const succeededAgents: MomAgentOutput[] = agentResults
    .filter((r): r is PromiseFulfilledResult<MomAgentOutput> => r.status === 'fulfilled')
    .map((r) => r.value);

  const QUORUM = 2;
  if (succeededAgents.length < QUORUM) {
    const failedCount = agentCount - succeededAgents.length;
    logger.warn({ chatRunId, failedCount, agentCount }, 'MoM quorum failed — falling back to single model');
    throw new Error(`MoM quorum failed: only ${succeededAgents.length}/${agentCount} agents succeeded`);
  }

  await insertChatRunEvent(chatRunId, 'AGENTS_COMPLETED', {
    succeeded: succeededAgents.length,
    failed: agentCount - succeededAgents.length,
  });

  // ── Review pass (Phase 2) ─────────────────────────────────────────
  // reviewsByAgentIndex maps agent index → review output (or null if review failed/skipped)
  const reviewsByAgentIndex = new Map<number, MomReviewOutput | null>();

  if (plannerOutput.review_required) {
    await insertChatRunEvent(chatRunId, 'REVIEW_STARTED', { agent_count: succeededAgents.length });

    const agentContext = buildAgentContext(context);

    // Run all reviews in parallel — failures are non-fatal
    await Promise.allSettled(
      succeededAgents.map(async (agentOutput, idx) => {
        const reviewRow = await createChatRunReview({
          chat_run_id: chatRunId,
          model_id: specialistModelId,
        });
        const startedAt = Date.now();

        try {
          const reviewUserContent = buildReviewUserContent({
            agentOutput: JSON.stringify(agentOutput, null, 2),
            userMessage,
            context: agentContext,
          });

          const response = await createChatCompletion({
            model: specialistModelId,
            messages: [
              { role: 'system', content: buildReviewSystemPrompt() },
              { role: 'user', content: reviewUserContent },
            ] as any,
            temperature: 0.1,
            max_tokens: 800,
          }, 45000);

          const latencyMs = Date.now() - startedAt;
          const raw = response.choices?.[0]?.message?.content ?? '';
          const reviewOutput = MomReviewOutputSchema.parse(JSON.parse(raw));

          const tokenUsage = response.usage
            ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens, total_tokens: response.usage.total_tokens }
            : undefined;

          await updateChatRunReview(reviewRow.id, {
            review_output: reviewOutput as unknown as Record<string, unknown>,
            latency_ms: latencyMs,
            ...(tokenUsage ? { token_usage: tokenUsage } : {}),
          });

          reviewsByAgentIndex.set(idx, reviewOutput);
          logger.info({ chatRunId, role: agentOutput.role, verdict: reviewOutput.verdict, latencyMs }, 'MoM review completed');

        } catch (err) {
          reviewsByAgentIndex.set(idx, null);
          logger.warn({ chatRunId, role: agentOutput.role, err }, 'MoM review failed — continuing without it');
        }
      }),
    );

    await insertChatRunEvent(chatRunId, 'REVIEW_COMPLETED', {
      reviewed: reviewsByAgentIndex.size,
      accepted: [...reviewsByAgentIndex.values()].filter((r) => r?.verdict === 'accept').length,
      partial: [...reviewsByAgentIndex.values()].filter((r) => r?.verdict === 'partial').length,
      rejected: [...reviewsByAgentIndex.values()].filter((r) => r?.verdict === 'reject').length,
    });
  }

  // ── Merge step ────────────────────────────────────────────────────
  await updateChatRunStatus(chatRunId, 'merging');
  await insertChatRunEvent(chatRunId, 'MERGE_STARTED', { agent_count: succeededAgents.length });

  // Enrich merge input with review findings when available
  const agentOutputsText = succeededAgents
    .map((a, i) => {
      const review = reviewsByAgentIndex.get(i);
      const reviewBlock = review
        ? `\n**Review (${review.verdict}):** ${review.notes}` +
          (review.challenged_claims.length > 0 ? `\nChallenged: ${review.challenged_claims.join('; ')}` : '') +
          (review.fabrications.length > 0 ? `\nFabrications flagged: ${review.fabrications.join('; ')}` : '')
        : '';
      return `### Agent ${i + 1}: ${a.role}\n${JSON.stringify(a, null, 2)}${reviewBlock}`;
    })
    .join('\n\n');

  const plannerSummary = [
    `strategy: ${plannerOutput.decomposition_strategy}`,
    `reason: ${plannerOutput.reason}`,
    `agent_count: ${agentCount}`,
  ].join('\n');

  const mergeUserContent = buildMergeUserContent({
    userMessage,
    plannerSummary,
    agentOutputsText,
  });

  let mergeOutput: { final_answer: string; confidence: number; trace_summary: string;
    consensus_points: string[]; disagreements: string[]; rejected_claims: string[]; missing_context: string[] };

  try {
    const mergeResponse = await createChatCompletion({
      model: mergeModelId,
      messages: [
        { role: 'system', content: buildMergeSystemPrompt() },
        { role: 'user', content: mergeUserContent },
      ] as any,
      temperature: 0.3,
      max_tokens: 2000,
    }, 90000);

    const mergeRaw = mergeResponse.choices?.[0]?.message?.content ?? '';
    const mergeParsed = JSON.parse(mergeRaw);
    mergeOutput = MomMergeOutputSchema.parse(mergeParsed);

  } catch (err) {
    logger.warn({ chatRunId, err }, 'MoM merge failed — falling back to best agent answer');
    // Fallback: use the highest-confidence agent's answer
    const bestAgent = succeededAgents.reduce((best, cur) =>
      cur.confidence > best.confidence ? cur : best
    );
    mergeOutput = {
      final_answer: bestAgent.answer,
      confidence: bestAgent.confidence,
      trace_summary: `Merge failed; using best agent: ${bestAgent.role}`,
      consensus_points: [],
      disagreements: [],
      rejected_claims: [],
      missing_context: [],
    };
  }

  // ── Persist final output ──────────────────────────────────────────
  await updateChatRunFinalOutput(chatRunId, mergeOutput as Record<string, unknown>, mergeModelId);
  await insertChatRunEvent(chatRunId, 'MERGE_COMPLETED', { confidence: mergeOutput.confidence });

  logger.info({ chatRunId, confidence: mergeOutput.confidence, agentCount }, 'MoM Lite completed');

  return mergeOutput.final_answer;
}

// ── Prompt builders ──────────────────────────────────────────────────

function buildAgentContext(context: ChatContext): string {
  const parts: string[] = [];
  if (context.systemBase) parts.push(context.systemBase);
  if (context.potContext) parts.push(`\n## Knowledge Base\n${context.potContext}`);
  if (context.threadExcerpt) parts.push(`\n## Recent Conversation\n${context.threadExcerpt}`);
  return parts.join('\n');
}

function buildAgentSystemPrompt(): string {
  return `You are a specialist AI agent in a Mixture of Models orchestration. You have been assigned a specific analytical role. Use ONLY the provided context — do not fabricate information. If the context is insufficient for your role, say so honestly.

Output ONLY valid JSON — no markdown, no explanation:
{
  "role": "<your assigned role>",
  "summary": "<one-sentence summary>",
  "answer": "<full answer in markdown>",
  "claims": ["<claim>"],
  "assumptions": ["<assumption>"],
  "evidence_refs": ["<verbatim excerpt>"],
  "missing_context": ["<what is missing>"],
  "risks": ["<risk or caveat>"],
  "confidence": <0.0-1.0>
}`;
}

function buildAgentUserContent(opts: {
  agentRole: string;
  agentFocus: string;
  userMessage: string;
  context: string;
}): string {
  return `## Your Role\n${opts.agentRole}: ${opts.agentFocus}\n\n## Question\n${opts.userMessage}\n\n## Context\n${opts.context.slice(0, 8000)}`;
}

function buildMergeSystemPrompt(): string {
  return `You are a synthesis model in a Mixture of Models orchestration. Receive specialist agent outputs and produce a final coherent answer. Preserve honest disagreements. Reject unsupported claims.

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
}

function buildMergeUserContent(opts: {
  userMessage: string;
  plannerSummary: string;
  agentOutputsText: string;
}): string {
  return `## Question\n${opts.userMessage}\n\n## Planner Decision\n${opts.plannerSummary}\n\n## Specialist Outputs\n${opts.agentOutputsText}`;
}

function buildReviewSystemPrompt(): string {
  return `You are a critical review model in a Mixture of Models orchestration. You receive the output of a specialist agent and evaluate it for accuracy, logical consistency, evidence quality, and completeness. Your job is to verify claims, flag unsupported assertions, and surface what the agent missed.

Use ONLY the provided context — do not inject external knowledge. Be precise and terse.

Output ONLY valid JSON — no markdown, no explanation:
{
  "target_agent_role": "<agent role string>",
  "verdict": "accept|partial|reject",
  "supported_claims": ["<claim confirmed by context>"],
  "challenged_claims": ["<claim that needs qualification or evidence>"],
  "fabrications": ["<claim not supported by any provided context>"],
  "missing_perspectives": ["<important angle the agent did not address>"],
  "suggested_additions": ["<concrete improvement suggestion>"],
  "confidence_delta": <-1.0 to 1.0, negative if agent is overconfident>,
  "notes": "<overall assessment under 100 words>"
}

Verdict: "accept" = solid output; "partial" = useful but has gaps; "reject" = substantially incorrect or fabricated.`;
}

function buildReviewUserContent(opts: {
  agentOutput: string;
  userMessage: string;
  context: string;
}): string {
  return `## Agent Output to Review\n${opts.agentOutput}\n\n## Original Question\n${opts.userMessage}\n\n## Available Context\n${opts.context.slice(0, 8000)}`;
}
