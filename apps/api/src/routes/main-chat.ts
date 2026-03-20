/**
 * Main Chat API Routes
 *
 * Endpoints for global (non-pot-scoped) AI chat (MainChat / Links Chat).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createChatCompletion } from '@links/ai';
import {
  getAIPreferences,
  logAuditEvent,
  createMainChatThread,
  getMainChatThread,
  listMainChatThreads,
  deleteMainChatThread,
  appendMainChatMessage,
  listMainChatMessages,
  getMainChatThreadMessageCount,
  getPreference,
  listMainChatNotifications,
  expireSnoozedMainChatNotifications,
  getDatabase,
  enqueueJob,
  createChatRun,
  updateChatRunStatus,
  updateChatRunPlanner,
  updateMainChatThreadTitle,
} from '@links/storage';
import type { MainChatMessageRecord } from '@links/storage';
import { createLogger } from '@links/logging';
import { assembleMainChatContext } from '../chat/contextAssembler.js';
import { runMomPlanner, runMomLite } from '../chat/momLiteService.js';

const logger = createLogger({ name: 'main-chat-routes' });

// ── Zod schemas ──────────────────────────────────────────────────────

const SendBodySchema = z.object({
  content: z.string().min(1).max(32000),
  thread_id: z.string().optional(),
  model_id: z.string().optional(),
  include_context: z.boolean().optional(),
  execution_mode: z.enum(['single', 'mom_lite', 'mom_standard', 'mom_heavy']).optional().default('single'),
});

const ThreadIdParamSchema = z.object({ threadId: z.string() });

// ── Style hints (shared with pot chat, copied to avoid cross-dep) ────

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

// ── Title derivation ─────────────────────────────────────────────────

function deriveThreadTitle(content: string): string {
  const firstLine = (content.split('\n')[0] ?? content).replace(/\s+/g, ' ').trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
}

// ── Citation parser (shared with pot chat) ───────────────────────────

function parseCitationsFromContent(content: string): { cleanContent: string; citations: unknown[] } {
  const lines = content.split('\n');
  const citLine = lines.findIndex((l) => l.trim().startsWith('CITATIONS:'));
  if (citLine === -1) return { cleanContent: content, citations: [] };

  const cleanContent = lines.slice(0, citLine).join('\n').trimEnd();

  const inlineJson = lines[citLine]!.replace(/^.*?CITATIONS:\s*/, '').trim();
  if (inlineJson) {
    try {
      const parsed = JSON.parse(inlineJson);
      if (Array.isArray(parsed)) return { cleanContent, citations: parsed };
    } catch { /* fall through */ }
  }

  const multiLineJson = lines.slice(citLine + 1).join('\n').trim();
  if (multiLineJson) {
    try {
      const parsed = JSON.parse(multiLineJson);
      if (Array.isArray(parsed)) return { cleanContent, citations: parsed };
    } catch { /* ignore */ }
  }

  return { cleanContent, citations: [] };
}

// ── Response formatter ───────────────────────────────────────────────

function formatMessageResponse(msg: MainChatMessageRecord) {
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

// ── Routes ───────────────────────────────────────────────────────────

export const mainChatRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /main-chat/threads ───────────────────────────────────────
  fastify.get('/main-chat/threads', async (_request, reply) => {
    const threads = await listMainChatThreads(50);
    const threadsWithCounts = await Promise.all(
      threads.map(async (t) => {
        const count = await getMainChatThreadMessageCount(t.id);
        return {
          id: t.id,
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

  // ── DELETE /main-chat/threads/:threadId ─────────────────────────
  fastify.delete<{ Params: { threadId: string } }>(
    '/main-chat/threads/:threadId',
    async (request, reply) => {
      const { threadId } = ThreadIdParamSchema.parse(request.params);

      const thread = await getMainChatThread(threadId);
      if (!thread) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }

      await deleteMainChatThread(threadId);

      await logAuditEvent({
        actor: 'user',
        action: 'delete_main_chat_thread',
        metadata: { thread_id: threadId },
      });

      return reply.status(204).send();
    },
  );

  // ── GET /main-chat/threads/:threadId/messages ───────────────────
  fastify.get<{ Params: { threadId: string } }>(
    '/main-chat/threads/:threadId/messages',
    async (request, reply) => {
      const { threadId } = ThreadIdParamSchema.parse(request.params);

      const thread = await getMainChatThread(threadId);
      if (!thread) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }

      const messages = await listMainChatMessages(threadId);
      return reply.status(200).send({ messages: messages.map(formatMessageResponse) });
    },
  );

  // ── GET /main-chat/context-pack ──────────────────────────────────
  fastify.get('/main-chat/context-pack', async (_request, reply) => {
    // Expire any snoozed notifications first
    await expireSnoozedMainChatNotifications().catch(() => { /* non-fatal */ });

    // Get pending notifications (max 5)
    const allNotifs = await listMainChatNotifications({ states: ['unread', 'opened'], limit: 5 })
      .catch(() => [] as any[]);
    const notifCount = allNotifs.length;

    // Get latest journal entry
    const db = getDatabase();
    const latestJournal = await db
      .selectFrom('journal_entries')
      .select(['period_start_ymd', 'content_json'])
      .where('kind', '=', 'daily')
      .orderBy('period_start_ymd', 'desc')
      .limit(1)
      .executeTakeFirst()
      .catch(() => null);

    let latestJournalSummary: { date: string; first_line: string } | null = null;
    if (latestJournal) {
      try {
        const content = typeof latestJournal.content_json === 'string'
          ? JSON.parse(latestJournal.content_json)
          : latestJournal.content_json;
        const headline = content?.headline ?? content?.what_happened?.[0]?.summary ?? '';
        latestJournalSummary = {
          date: latestJournal.period_start_ymd as string,
          first_line: headline.slice(0, 200),
        };
      } catch { /* skip */ }
    }

    // Recent entry count (last 48 hours)
    const since48h = Date.now() - 48 * 60 * 60 * 1000;
    const entryCountRow = await db
      .selectFrom('entries')
      .select(db.fn.count('id').as('count'))
      .where('created_at', '>=', since48h)
      .executeTakeFirst()
      .catch(() => null);
    const recentEntryCount = Number(entryCountRow?.count ?? 0);

    // Greeting based on time of day
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    // Latest weekly research digest (last 14 days, not dismissed)
    const latestDigestRow = await db
      .selectFrom('main_chat_notifications')
      .select(['payload_json', 'created_at'])
      .where('type', '=', 'digest')
      .where('state', '!=', 'dismissed')
      .where('created_at', '>=', Date.now() - 14 * 24 * 60 * 60 * 1000)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
      .catch(() => null);

    let latestDigestSummary: { date: string; headline: string } | null = null;
    if (latestDigestRow) {
      try {
        const p = typeof latestDigestRow.payload_json === 'string'
          ? JSON.parse(latestDigestRow.payload_json)
          : latestDigestRow.payload_json;
        if (p?.date_ymd && p?.headline) {
          latestDigestSummary = {
            date: p.date_ymd as string,
            headline: (p.headline as string).slice(0, 150),
          };
        }
      } catch { /* skip */ }
    }

    // Fire greeting nudge (fire-and-forget)
    enqueueJob({
      job_type: 'generate_nudges',
      priority: 5,
      payload: { trigger: 'greeting' },
    }).catch(() => { /* non-fatal */ });

    return reply.status(200).send({
      greeting,
      notification_count: notifCount,
      notifications: allNotifs.map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        preview: n.preview,
      })),
      latest_journal: latestJournalSummary,
      latest_digest: latestDigestSummary,
      recent_entry_count: recentEntryCount,
    });
  });

  // ── POST /main-chat/send ─────────────────────────────────────────
  fastify.post('/main-chat/send', async (request, reply) => {
    // Step 1: Parse body
    const body = SendBodySchema.parse(request.body);

    // Step 2: Get or create thread
    let threadId: string;
    let isNewThread = false;
    if (body.thread_id) {
      const existing = await getMainChatThread(body.thread_id);
      if (!existing) {
        return reply.status(404).send({
          error: 'NotFoundError',
          message: 'Thread not found',
          statusCode: 404,
          request_id: request.id,
        });
      }
      threadId = existing.id;
    } else {
      const thread = await createMainChatThread({ model_id: body.model_id });
      threadId = thread.id;
      isNewThread = true;
    }

    // Derive and persist a title for new threads immediately so the sidebar shows it
    const threadTitle = isNewThread ? deriveThreadTitle(body.content) : undefined;
    if (threadTitle) {
      updateMainChatThreadTitle(threadId, threadTitle).catch(() => { /* non-fatal */ });
    }

    // Step 3: Append user message
    const userMsg = await appendMainChatMessage({
      thread_id: threadId,
      role: 'user',
      content: body.content,
    });

    // Step 3b: Build context block for new-thread context injection (Slice 3)
    let contextBlock = '';
    if (body.include_context && !body.thread_id) {
      try {
        const db2 = getDatabase();
        const hour = new Date().getHours();
        const greeting2 = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        const since48h = Date.now() - 48 * 60 * 60 * 1000;
        const entryCountRow2 = await db2
          .selectFrom('entries')
          .select(db2.fn.count('id').as('count'))
          .where('created_at', '>=', since48h)
          .executeTakeFirst();
        const recentCount = Number(entryCountRow2?.count ?? 0);

        const latestJournal2 = await db2
          .selectFrom('journal_entries')
          .select(['period_start_ymd', 'content_json'])
          .where('kind', '=', 'daily')
          .orderBy('period_start_ymd', 'desc')
          .limit(1)
          .executeTakeFirst();

        const lines = [`[Context — ${greeting2} session]`];
        if (recentCount > 0) lines.push(`- ${recentCount} item${recentCount !== 1 ? 's' : ''} captured in the last 48 hours`);
        if (latestJournal2) {
          try {
            const content2 = typeof latestJournal2.content_json === 'string'
              ? JSON.parse(latestJournal2.content_json as string)
              : latestJournal2.content_json;
            const headline2: string = content2?.headline ?? content2?.what_happened?.[0]?.summary ?? '';
            if (headline2) lines.push(`- Latest journal (${latestJournal2.period_start_ymd}): ${headline2.slice(0, 120)}`);
          } catch { /* skip */ }
        }
        contextBlock = lines.join('\n');
      } catch { /* non-fatal */ }
    }

    // Step 4: Load style profile
    const styleProfile = await getPreference<StyleProfileHints>('dictionize.profile').catch(() => null);
    const styleHintsText = styleProfile ? buildStyleHints(styleProfile) : '';

    // Step 5: Resolve model
    const aiPrefs = await getAIPreferences();
    const modelId = body.model_id || aiPrefs.task_models?.chat || aiPrefs.default_model || 'x-ai/grok-4.1-fast';

    // Step 6: Load thread history (last 20 messages)
    const historyMsgs = await listMainChatMessages(threadId);
    const recentHistory = historyMsgs.slice(-20);

    // Step 7: Build messages array
    const systemPrompt = [
      `You are Links' global assistant — a direct, sharp general-purpose AI built into Links.`,
      ``,
      `You help the user think, research, plan, and organize ideas.`,
      `You do not have access to research pots unless content is explicitly provided.`,
      `Be evidence-first: when making claims, state your basis. Be concise and honest.`,
      `If you don't know something, say so plainly rather than speculating.`,
      `Use markdown formatting for anything longer than two sentences.`,
      contextBlock ? `\n## Session Context\n${contextBlock}` : '',
      styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
    ].filter(Boolean).join('\n');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of recentHistory) {
      if (m.role === 'system') continue;
      messages.push({ role: m.role, content: m.content });
    }

    // Step 8: Call AI
    const executionMode = body.execution_mode ?? 'single';
    let assistantContent = '';
    let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    let citations: unknown[] = [];
    let momRunId: string | null = null;

    if (executionMode === 'mom_standard' || executionMode === 'mom_heavy') {
      // ── MoM Standard / Heavy — worker-backed ─────────────────────
      const chatRun = await createChatRun({
        thread_id: threadId,
        user_message_id: userMsg.id,
        chat_surface: 'main',
        execution_mode: executionMode,
      });

      const placeholder = await appendMainChatMessage({
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
        surface: 'main' as const,
        user_message: body.content,
        planner_model_id: momPlannerModelId,
        specialist_model_id: momSpecialistModelId,
        merge_model_id: momMergeModelId,
        target_mode: executionMode,
      };

      await enqueueJob({ job_type: 'mom_plan', payload: momPayload, priority: 5 });

      await logAuditEvent({
        actor: 'user',
        action: 'main_chat_message',
        metadata: { thread_id: threadId, model_id: modelId, execution_mode: executionMode, mom_run_id: chatRun.id },
      });

      return reply.status(200).send({
        thread_id: threadId,
        thread_title: threadTitle,
        assistant_message: {
          id: placeholder.id,
          role: placeholder.role,
          content: placeholder.content,
          timestamp: placeholder.created_at,
        },
        mom_run_id: chatRun.id,
      });
    } else if (executionMode === 'mom_lite') {
      // ── MoM Lite path ────────────────────────────────────────────
      let usedMom = false;
      try {
        const chatContext = await assembleMainChatContext({
          threadId,
          contextBlock,
        });

        const chatRun = await createChatRun({
          thread_id: threadId,
          user_message_id: undefined,
          chat_surface: 'main',
          execution_mode: 'mom_lite',
        });
        momRunId = chatRun.id;

        const aiPrefsForMom = await getAIPreferences();
        const MOM_DEFAULT_LITE = 'x-ai/grok-4.1-fast';
        const plannerModelId = aiPrefsForMom.mom_models?.planner ?? MOM_DEFAULT_LITE;
        const specialistModelId = aiPrefsForMom.mom_models?.specialist ?? MOM_DEFAULT_LITE;
        const mergeModelId = aiPrefsForMom.mom_models?.merge ?? MOM_DEFAULT_LITE;

        await updateChatRunStatus(momRunId, 'planning');

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
          logger.warn({ err: planErr, threadId }, 'MoM planner failed — falling back to single model');
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
            logger.warn({ err: momErr, threadId }, 'MoM Lite execution failed — falling back to single model');
            await updateChatRunStatus(momRunId, 'failed', { error_message: String(momErr).slice(0, 500) });
          }
        }
      } catch (err) {
        logger.warn({ err, threadId }, 'MoM Lite setup failed — falling back to single model');
      }

      if (!usedMom) {
        // Fall back to single-model
        try {
          const response = await createChatCompletion({
            model: modelId,
            messages: messages as any,
            temperature: 0.5,
            max_tokens: 2048,
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
          logger.error({ err, threadId }, 'Main chat completion fallback failed');
          assistantContent = `I encountered an error processing your message: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    } else {
      // ── Single-model path ─────────────────────────────────────────
      try {
        const response = await createChatCompletion({
          model: modelId,
          messages: messages as any,
          temperature: 0.5,
          max_tokens: 2048,
        }, 120000);

        const rawContent = response.choices?.[0]?.message?.content ?? '';

        // Step 9: Parse citations
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
        logger.error({ err, threadId }, 'Main chat completion failed');
        assistantContent = `I encountered an error processing your message: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    // Step 10: Append assistant message and return
    const assistantMsg = await appendMainChatMessage({
      thread_id: threadId,
      role: 'assistant',
      content: assistantContent,
      citations_json: citations.length > 0 ? JSON.stringify(citations) : null,
      token_usage_json: tokenUsage ? JSON.stringify(tokenUsage) : null,
      model_id: modelId,
    });

    await logAuditEvent({
      actor: 'user',
      action: 'main_chat_message',
      metadata: {
        thread_id: threadId,
        model_id: modelId,
        execution_mode: executionMode,
        ...(momRunId ? { mom_run_id: momRunId } : {}),
      },
    });

    return reply.status(200).send({
      thread_id: threadId,
      thread_title: threadTitle,
      assistant_message: formatMessageResponse(assistantMsg),
      ...(momRunId ? { mom_run_id: momRunId } : {}),
    });
  });
};
