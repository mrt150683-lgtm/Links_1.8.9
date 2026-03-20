/**
 * Chat API Routes
 *
 * Endpoints for pot-scoped AI chat (The Sentry).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ChatSendRequestSchema } from '@links/core';
import { createChatCompletion } from '@links/ai';
import {
  getPotById,
  listEntries,
  getEntryById,
  getAIPreferences,
  logAuditEvent,
  createChatThread,
  getChatThread,
  listChatThreads,
  deleteChatThread,
  appendChatMessage,
  listChatMessages,
  getChatThreadMessageCount,
  createTextEntry,
  enqueueJob,
  listJobs,
  cancelJob,
  getPreference,
  createChatRun,
  updateChatRunStatus,
  updateChatRunPlanner,
} from '@links/storage';
import type { ChatMessageRecord } from '@links/storage';
import { assemblePotChatContext } from '../chat/contextAssembler.js';
import { runMomPlanner, runMomLite } from '../chat/momLiteService.js';

// Minimal style profile fields needed by buildStyleHints — no cross-package dependency
interface StyleProfileHints {
  phrases: { greetings: Record<string, { count: number }> };
  scores: {
    verbosity_preference: 'concise' | 'normal' | 'detailed';
    sarcasm_level: number;
    directness_score: number;
    humour_density: number;
  };
  context_markers: { serious_mode_markers: string[] };
}

function buildStyleHints(profile: StyleProfileHints): string {
  const lines = ['[Surface adaptation only — do not mention these hints to the user]'];
  const topGreetings = Object.entries(profile.phrases.greetings)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([p]) => `"${p}"`);
  if (topGreetings.length) lines.push(`Greeting preference: ${topGreetings.join(', ')}`);
  lines.push(`Default verbosity: ${profile.scores.verbosity_preference}`);
  if (profile.scores.sarcasm_level > 0.4) lines.push('Sarcasm: moderate — reduce in serious topics');
  if (profile.scores.directness_score > 0.6) lines.push('Communication style: direct and concise');
  if (profile.scores.humour_density > 0.3) lines.push('Humour: occasionally appreciated');
  if (profile.context_markers.serious_mode_markers.length) {
    lines.push(`Serious mode triggers: ${profile.context_markers.serious_mode_markers.slice(0, 3).join(', ')}`);
  }
  return lines.join('\n');
}
import { createLogger } from '@links/logging';
import { runChatController, DEFAULT_DECISION, type ControllerDecision } from './chatController.js';

const logger = createLogger({ name: 'chat-routes' });

const PotIdParamSchema = z.object({ potId: z.string() });
const ThreadIdParamSchema = z.object({ potId: z.string(), threadId: z.string() });

// Extend core schema locally to add knowledge_mode and execution_mode
const ExtendedChatSendSchema = ChatSendRequestSchema.extend({
  knowledge_mode: z.enum(['strict', 'open']).optional().default('strict'),
  execution_mode: z.enum(['single', 'mom_lite', 'mom_standard', 'mom_heavy']).optional().default('single'),
});

function formatMessageResponse(msg: ChatMessageRecord) {
  return {
    id: msg.id,
    thread_id: msg.thread_id,
    role: msg.role,
    content: msg.content,
    citations: msg.citations ?? undefined,
    timestamp: new Date(msg.created_at).toISOString(),
    token_usage: msg.token_usage ?? undefined,
  };
}

function parseCitationsFromContent(content: string): { cleanContent: string; citations: unknown[] } {
  const lines = content.split('\n');
  const citLine = lines.findIndex((l) => l.trim().startsWith('CITATIONS:'));
  if (citLine === -1) return { cleanContent: content, citations: [] };

  // Always strip CITATIONS section from the clean content, even if JSON can't be parsed
  const cleanContent = lines.slice(0, citLine).join('\n').trimEnd();

  // Try inline: "CITATIONS: [{...}]" all on one line
  const inlineJson = lines[citLine]!.replace(/^.*?CITATIONS:\s*/, '').trim();
  if (inlineJson) {
    try {
      const parsed = JSON.parse(inlineJson);
      if (Array.isArray(parsed)) return { cleanContent, citations: parsed };
    } catch { /* fall through to multi-line */ }
  }

  // Try multi-line: "CITATIONS:" on its own line, JSON array on subsequent lines
  const multiLineJson = lines.slice(citLine + 1).join('\n').trim();
  if (multiLineJson) {
    try {
      const parsed = JSON.parse(multiLineJson);
      if (Array.isArray(parsed)) return { cleanContent, citations: parsed };
    } catch { /* ignore */ }
  }

  // Even if JSON can't be parsed, return cleanContent so raw JSON never shows in the chat
  return { cleanContent, citations: [] };
}

function buildControllerDirective(d: ControllerDecision): string {
  const lines = [
    '',
    '## Response Instructions',
    `MODE=${d.mode}; VERBOSITY=${d.verbosity}; FORMAT=${d.format}`,
  ];

  if (d.mode === 'greeting') {
    lines.push(
      "Respond with exactly ONE sentence. Do not say \"How can I help you today?\" or similar call-centre phrases. End with 2–3 suggestion chips on the next line: e.g. *(Summarize pot · Find gaps · What's connected)*",
    );
  }

  if (d.needs_more_context) {
    lines.push(
      "If the user asks about an entry whose full content isn't in Active Context, say: 'I can see [title] in the pot but its full content isn't loaded. Press [+] to add it to context, then ask again.' Do not apologize vaguely.",
    );
  }

  if (d.verbosity === 'short') {
    lines.push(`Keep your response concise — under ${d.max_tokens} tokens.`);
  }

  return lines.join('\n');
}

export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /pots/:potId/chat/send ─────────────────────────────────
  fastify.post<{ Params: { potId: string } }>('/pots/:potId/chat/send', async (request, reply) => {
    const { potId } = PotIdParamSchema.parse(request.params);
    const body = ExtendedChatSendSchema.parse(request.body);
    const knowledgeMode = body.knowledge_mode ?? 'strict';
    const executionMode = body.execution_mode ?? 'single';

    // Verify pot exists
    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Get or create thread
    let threadId = body.thread_id;
    if (!threadId) {
      const thread = await createChatThread(potId, {
        model_id: body.model_id,
      });
      threadId = thread.id;
    } else {
      const existing = await getChatThread(threadId);
      if (!existing || existing.pot_id !== potId) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }
    }

    // Append user message
    const userMsg = await appendChatMessage({
      thread_id: threadId,
      role: 'user',
      content: body.content,
    });

    // Schedule style extraction 20 minutes after the LAST message.
    // Cancel any existing queued job for this thread first, so only one pending
    // job exists per thread at a time (prevents N pending entries in the Jobs UI).
    listJobs({ job_type: 'dictionize_user_style', status: 'queued', pot_id: potId })
      .then(async (existing) => {
        for (const j of existing) {
          const p = j.payload as { thread_id?: string } | null;
          if (p?.thread_id === threadId) {
            await cancelJob(j.id);
          }
        }
        return enqueueJob({
          job_type: 'dictionize_user_style',
          pot_id: potId,
          priority: 10,
          run_after: Date.now() + 20 * 60 * 1000,
          payload: { thread_id: threadId },
        });
      })
      .catch(err => logger.warn({ err }, 'Failed to enqueue dictionize job'));

    // Load style profile for personalized hints
    const styleProfile = await getPreference<StyleProfileHints>('dictionize.profile').catch(() => null);
    const styleHintsText = styleProfile ? buildStyleHints(styleProfile) : '';

    // Build context
    const entries = await listEntries({ pot_id: potId });
    const metadataContext = entries.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.source_title || e.link_title || `${e.type} entry`,
      capturedAt: new Date(e.captured_at).toISOString(),
      hasContent: !!e.content_text,
    }));

    // Load active context entries (full content)
    let activeContextText = '';
    if (body.active_context_entry_ids && body.active_context_entry_ids.length > 0) {
      const contextEntries = await Promise.all(
        body.active_context_entry_ids.map((id: string) => getEntryById(id)),
      );
      const validEntries = contextEntries.filter((e): e is NonNullable<typeof e> => e !== null);
      activeContextText = validEntries
        .map((e) => `### Entry: ${e.source_title || e.id} (${e.type})\n${e.content_text || '[no content]'}`)
        .join('\n\n');
    }

    // Build system prompt — varies by knowledge mode
    const systemPrompt = knowledgeMode === 'open'
      ? [
          `You are "The Navigator" — a research co-pilot built into Links, operating in Open Knowledge mode.`,
          ``,
          `Your job is to help the user explore their research AND connect it to the wider world. Use the pot's entries as your primary reference — always prefer and cite them when they address the question. When the user asks about topics beyond what is in the pot (regulatory bodies, scientific background, historical context, related concepts, domain expertise), answer freely using your training knowledge, and clearly prefix such statements with **"Based on general knowledge:"** so the user can distinguish pot-sourced facts from broader context.`,
          ``,
          `Traits: evidence-first for pot content (cite everything you draw from the pot), broadly informed (leverage training knowledge for context and background), sharp (notice connections between the pot and the wider domain), concise and honest.`,
          ``,
          pot.goal_text ? `## Research Goal\n${pot.goal_text}` : '',
          `## Research Pot: "${pot.name}"`,
          ``,
          `This pot contains ${entries.length} entries. Entry metadata:`,
          ``,
          JSON.stringify(metadataContext, null, 2),
          activeContextText ? `\n## Active Context (full content for selected entries)\n\n${activeContextText}` : '',
          ``,
          `## Citations`,
          `When your response draws on specific pot entries, end your reply with exactly one line:`,
          `CITATIONS: [{"entryId": "...", "confidence": 0.0-1.0, "snippet": "..."}]`,
          `Each snippet must be a short verbatim excerpt from the entry that supports the claim.`,
          `Omit the CITATIONS line for conversational exchanges or responses that draw entirely from general knowledge.`,
          ``,
          `## Rules`,
          `- When pot content is available for a question, use it and cite it — prefer pot entries over general knowledge`,
          `- For facts from your training knowledge, prefix the sentence with **"Based on general knowledge:"**`,
          `- Never fabricate sources; never claim training knowledge is from the pot`,
          `- When multiple entries relate to a topic, synthesize across them and cite each`,
          `- Use markdown formatting when the response is more than one or two sentences`,
          `- If asked what model you are: state your model ID, then your role name (The Navigator — Open Knowledge mode)`,
          styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
        ].join('\n')
      : [
          `You are "The Sentry" — a calm, evidence-first research co-pilot built into Links.`,
          ``,
          `Your job is to help the user explore, understand, and connect the research they have collected in this pot. You ground every factual claim in the entries provided — you never speculate or invent. When context is insufficient to answer, say so directly; that is a complete and honest answer.`,
          ``,
          `Traits: evidence-first (every claim about the research traces to a source), sharp (you notice patterns, contradictions, and gaps), concise (answer what was asked, nothing more), honest (admitting you can't find something is always better than guessing).`,
          ``,
          pot.goal_text ? `## Research Goal\n${pot.goal_text}` : '',
          `## Research Pot: "${pot.name}"`,
          ``,
          `This pot contains ${entries.length} entries. Entry metadata:`,
          ``,
          JSON.stringify(metadataContext, null, 2),
          activeContextText ? `\n## Active Context (full content for selected entries)\n\n${activeContextText}` : '',
          ``,
          `## Citations`,
          `When your response draws on specific entries, end your reply with exactly one line:`,
          `CITATIONS: [{"entryId": "...", "confidence": 0.0-1.0, "snippet": "..."}]`,
          `Each snippet must be a short verbatim excerpt from the entry that supports the claim.`,
          `Omit the CITATIONS line entirely for conversational exchanges, clarifications, or meta questions where no pot content was referenced.`,
          ``,
          `## Rules`,
          `- Do not invent or assume facts not present in the provided context`,
          `- If the information is not in the pot, say so plainly — do not speculate`,
          `- When multiple entries relate to a topic, synthesize across them and cite each`,
          `- Use markdown formatting when the response is more than one or two sentences`,
          `- If asked what model you are: state your model ID, then your role name (The Sentry)`,
          styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
        ].join('\n');

    // Resolve model
    const aiPrefs = await getAIPreferences();
    const modelId = body.model_id || aiPrefs.task_models?.chat || aiPrefs.default_model || 'x-ai/grok-4.1-fast';

    // ── Controller ──────────────────────────────────────────────────────────
    // Fetch history once — used both for controller stats and conversation build
    const historyMsgs = await listChatMessages(threadId);
    const ctxTokenEstimate = Math.ceil(activeContextText.length / 4);
    let controllerDecision: ControllerDecision = DEFAULT_DECISION;
    try {
      controllerDecision = await runChatController({
        userText: body.content,
        historyLength: historyMsgs.length,
        activeContextTokens: ctxTokenEstimate,
        potEntryCount: entries.length,
        modelId,
      });
    } catch {
      // runChatController already logs; keep default
    }

    // Apply style-profile verbosity cap before building final prompt
    if (styleProfile?.scores.verbosity_preference === 'concise'
        && controllerDecision.verbosity === 'medium') {
      controllerDecision = { ...controllerDecision, max_tokens: Math.min(controllerDecision.max_tokens, 400) };
    }

    // Build conversation history (apply controller directive to system prompt)
    const finalSystemPrompt = systemPrompt + buildControllerDirective(controllerDecision);
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: finalSystemPrompt },
    ];

    // Add all history except the just-appended user message (it's the last one)
    for (const m of historyMsgs) {
      if (m.role === 'system') continue; // skip system messages in history
      messages.push({ role: m.role, content: m.content });
    }

    // Call AI
    let assistantContent = '';
    let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    let citations: unknown[] = [];
    let momRunId: string | null = null;

    if (executionMode === 'mom_standard' || executionMode === 'mom_heavy') {
      // ── MoM Standard / Heavy — worker-backed ─────────────────────
      // Immediately return a placeholder; worker completes in background.
      const chatRun = await createChatRun({
        thread_id: threadId,
        pot_id: potId,
        user_message_id: userMsg.id,
        chat_surface: 'pot',
        execution_mode: executionMode,
      });

      const placeholder = await appendChatMessage({
        thread_id: threadId,
        role: 'assistant',
        content: `[MoM ${executionMode === 'mom_heavy' ? 'Heavy' : 'Standard'} analysis in progress…]`,
        model_id: modelId,
      });

      const aiPrefsForMom = await getAIPreferences();
      const MOM_DEFAULT = 'x-ai/grok-4.1-fast';
      const momPlannerModelId = aiPrefsForMom.mom_models?.planner ?? MOM_DEFAULT;
      const momSpecialistModelId = aiPrefsForMom.mom_models?.specialist ?? MOM_DEFAULT;
      const momMergeModelId = aiPrefsForMom.mom_models?.merge ?? MOM_DEFAULT;

      const momPayload = {
        chat_run_id: chatRun.id,
        thread_id: threadId,
        assistant_message_id: placeholder.id,
        surface: 'pot' as const,
        user_message: body.content,
        pot_id: potId,
        planner_model_id: momPlannerModelId,
        specialist_model_id: momSpecialistModelId,
        merge_model_id: momMergeModelId,
        target_mode: executionMode,
      };

      await enqueueJob({ job_type: 'mom_plan', pot_id: potId, payload: momPayload, priority: 5 });

      await logAuditEvent({
        actor: 'user',
        action: 'chat_message',
        pot_id: potId,
        metadata: { thread_id: threadId, model_id: modelId, execution_mode: executionMode, mom_run_id: chatRun.id },
      });

      return reply.status(200).send({
        thread_id: threadId,
        user_message: formatMessageResponse(userMsg),
        assistant_message: formatMessageResponse(placeholder),
        mom_run_id: chatRun.id,
      });
    } else if (executionMode === 'mom_lite') {
      // ── MoM Lite path ────────────────────────────────────────────
      let usedMom = false;
      try {
        const chatContext = await assemblePotChatContext({
          potId,
          threadId,
          knowledgeMode,
          activeContextEntryIds: body.active_context_entry_ids ?? [],
        });

        const chatRun = await createChatRun({
          thread_id: threadId,
          pot_id: potId,
          user_message_id: userMsg.id,
          chat_surface: 'pot',
          execution_mode: 'mom_lite',
        });
        momRunId = chatRun.id;

        const aiPrefsForMom = await getAIPreferences();
        const MOM_DEFAULT_LITE = 'x-ai/grok-4.1-fast';
        const plannerModelId = aiPrefsForMom.mom_models?.planner ?? MOM_DEFAULT_LITE;
        const specialistModelId = aiPrefsForMom.mom_models?.specialist ?? MOM_DEFAULT_LITE;
        const mergeModelId = aiPrefsForMom.mom_models?.merge ?? MOM_DEFAULT_LITE;

        await updateChatRunStatus(momRunId, 'planning');

        // Run planner
        let plannerOutput;
        try {
          plannerOutput = await runMomPlanner({
            userMessage: body.content,
            context: chatContext,
            plannerModelId,
            prefs: aiPrefsForMom,
          });
          await updateChatRunPlanner(momRunId, plannerOutput as unknown as Record<string, unknown>, plannerModelId);
        } catch (planErr) {
          logger.warn({ err: planErr, potId, threadId }, 'MoM planner failed — falling back to single model');
          await updateChatRunStatus(momRunId, 'failed', { error_message: 'Planner failed' });
          plannerOutput = null;
        }

        if (plannerOutput && plannerOutput.should_use_mom) {
          try {
            assistantContent = await runMomLite({
              chatRunId: momRunId,
              userMessage: body.content,
              context: chatContext,
              plannerOutput,
              specialistModelId,
              mergeModelId,
              prefs: aiPrefsForMom,
            });
            usedMom = true;
          } catch (momErr) {
            logger.warn({ err: momErr, potId, threadId }, 'MoM Lite execution failed — falling back to single model');
            await updateChatRunStatus(momRunId, 'failed', { error_message: String(momErr).slice(0, 500) });
          }
        }
      } catch (err) {
        logger.warn({ err, potId, threadId }, 'MoM Lite setup failed — falling back to single model');
      }

      if (!usedMom) {
        // Fall back to single-model path
        try {
          const response = await createChatCompletion({
            model: modelId,
            messages: messages as any,
            temperature: controllerDecision.temperature,
            max_tokens: controllerDecision.max_tokens,
          }, 120000);

          const rawContent = response.choices?.[0]?.message?.content ?? '';
          const parsed = parseCitationsFromContent(rawContent);
          assistantContent = parsed.cleanContent;
          citations = parsed.citations;

          if (response.usage) {
            tokenUsage = {
              prompt_tokens: response.usage.prompt_tokens,
              completion_tokens: response.usage.completion_tokens,
              total_tokens: response.usage.total_tokens,
            };
          }
        } catch (err) {
          logger.error({ err, potId, threadId }, 'Chat completion fallback failed');
          assistantContent = `I encountered an error processing your message: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    } else {
      // ── Single-model path (default) ───────────────────────────────
      try {
        const response = await createChatCompletion({
          model: modelId,
          messages: messages as any,
          temperature: controllerDecision.temperature,
          max_tokens: controllerDecision.max_tokens,
        }, 120000); // 2 minute timeout for chat

        const rawContent = response.choices?.[0]?.message?.content ?? '';
        const parsed = parseCitationsFromContent(rawContent);
        assistantContent = parsed.cleanContent;
        citations = parsed.citations;

        if (response.usage) {
          tokenUsage = {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          };
        }
      } catch (err) {
        logger.error({ err, potId, threadId }, 'Chat completion failed');
        assistantContent = `I encountered an error processing your message: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    // Append assistant message
    const assistantMsg = await appendChatMessage({
      thread_id: threadId,
      role: 'assistant',
      content: assistantContent,
      citations_json: citations.length > 0 ? JSON.stringify(citations) : null,
      token_usage_json: tokenUsage ? JSON.stringify(tokenUsage) : null,
      model_id: modelId,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'chat_message',
      pot_id: potId,
      metadata: {
        thread_id: threadId,
        model_id: modelId,
        knowledge_mode: knowledgeMode,
        execution_mode: executionMode,
        controller_mode: controllerDecision.mode,
        controller_verbosity: controllerDecision.verbosity,
        controller_max_tokens: controllerDecision.max_tokens,
        ...(momRunId ? { mom_run_id: momRunId } : {}),
      },
    });

    return reply.status(200).send({
      thread_id: threadId,
      user_message: formatMessageResponse(userMsg),
      assistant_message: formatMessageResponse(assistantMsg),
      ...(momRunId ? { mom_run_id: momRunId } : {}),
    });
  });

  // ── GET /pots/:potId/chat/threads ───────────────────────────────
  fastify.get<{ Params: { potId: string } }>('/pots/:potId/chat/threads', async (request, reply) => {
    const { potId } = PotIdParamSchema.parse(request.params);

    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: 'Pot not found',
        statusCode: 404,
        request_id: request.id,
      });
    }

    const threads = await listChatThreads(potId);
    const threadsWithCounts = await Promise.all(
      threads.map(async (t) => {
        const count = await getChatThreadMessageCount(t.id);
        return {
          id: t.id,
          pot_id: t.pot_id,
          title: t.title,
          model_id: t.model_id,
          created_at: new Date(t.created_at).toISOString(),
          updated_at: new Date(t.updated_at).toISOString(),
          message_count: count,
        };
      }),
    );

    return reply.status(200).send({ threads: threadsWithCounts });
  });

  // ── GET /pots/:potId/chat/threads/:threadId ─────────────────────
  fastify.get<{ Params: { potId: string; threadId: string } }>(
    '/pots/:potId/chat/threads/:threadId',
    async (request, reply) => {
      const { potId, threadId } = ThreadIdParamSchema.parse(request.params);

      const thread = await getChatThread(threadId);
      if (!thread || thread.pot_id !== potId) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }

      const messages = await listChatMessages(threadId);
      return reply.status(200).send({
        id: thread.id,
        pot_id: thread.pot_id,
        title: thread.title,
        model_id: thread.model_id,
        created_at: new Date(thread.created_at).toISOString(),
        updated_at: new Date(thread.updated_at).toISOString(),
        messages: messages.map(formatMessageResponse),
        message_count: messages.length,
      });
    },
  );

  // ── DELETE /pots/:potId/chat/threads/:threadId ──────────────────
  fastify.delete<{ Params: { potId: string; threadId: string } }>(
    '/pots/:potId/chat/threads/:threadId',
    async (request, reply) => {
      const { potId, threadId } = ThreadIdParamSchema.parse(request.params);

      const thread = await getChatThread(threadId);
      if (!thread || thread.pot_id !== potId) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }

      await deleteChatThread(threadId);

      await logAuditEvent({
        actor: 'user',
        action: 'delete_chat_thread',
        pot_id: potId,
        metadata: { thread_id: threadId },
      });

      return reply.status(204).send();
    },
  );

  // ── POST /pots/:potId/chat/threads/:threadId/save-as-entry ─────
  fastify.post<{ Params: { potId: string; threadId: string } }>(
    '/pots/:potId/chat/threads/:threadId/save-as-entry',
    async (request, reply) => {
      const { potId, threadId } = ThreadIdParamSchema.parse(request.params);

      const thread = await getChatThread(threadId);
      if (!thread || thread.pot_id !== potId) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }

      const messages = await listChatMessages(threadId);

      // Format transcript
      const transcript = messages
        .map((m) => `[${m.role.toUpperCase()}] ${new Date(m.created_at).toISOString()}\n${m.content}`)
        .join('\n\n---\n\n');

      const title = thread.title || `Chat transcript (${messages.length} messages)`;

      const entry = await createTextEntry({
        pot_id: potId,
        content_text: transcript,
        capture_method: 'chat_transcript',
        source_title: title,
      });

      await logAuditEvent({
        actor: 'user',
        action: 'save_chat_as_entry',
        pot_id: potId,
        entry_id: entry.id,
        metadata: { thread_id: threadId, message_count: messages.length },
      });

      return reply.status(201).send(entry);
    },
  );
};
