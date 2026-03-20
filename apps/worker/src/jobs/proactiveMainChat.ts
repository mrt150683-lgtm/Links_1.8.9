/**
 * proactiveMainChat
 *
 * Creates an agent-initiated conversation in Main Chat based on the user's
 * past 50 chat threads (capped at ~20k tokens). Fires 1–2× per day when
 * proactive_main_chat_enabled is set in automation.prefs.
 */

import * as path from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  listMainChatThreads,
  listMainChatMessages,
  getPreference,
  setPreference,
  getAIPreferences,
  createMainChatThread,
  appendMainChatMessage,
  createMainChatNotification,
  logAuditEvent,
  getSystemTimezone,
} from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:proactive-main-chat' });
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';
const CHAR_CAP = 80_000; // ~20k tokens at 4 chars/token

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try { return path.join(path.dirname(process.execPath), 'resources', 'prompts'); }
  catch { return path.join(process.cwd(), '../../apps/launcher/resources/prompts'); }
}

function localHour(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10);
}

export async function proactiveMainChatHandler(ctx: JobContext): Promise<void> {
  // Load global automation prefs to check enabled flag
  const automationPrefs = await getPreference<Record<string, unknown>>('automation.prefs') ?? {};
  if (!automationPrefs.proactive_main_chat_enabled) {
    logger.info({ job_id: ctx.jobId, msg: 'Proactive main chat disabled — skipping' });
    return;
  }

  // Hard block before 08:00
  const tz = getSystemTimezone() ?? 'UTC';
  if (localHour(tz) < 8) {
    logger.info({ job_id: ctx.jobId, msg: 'Night hours (< 08:00) — proactive main chat skipped' });
    return;
  }

  // Load last 50 main chat threads
  const threads = await listMainChatThreads(50).catch(() => []);

  // Build condensed chat digest capped at CHAR_CAP characters
  let digest = '';
  let threadCount = 0;
  for (const thread of threads) {
    if (digest.length >= CHAR_CAP) break;
    const messages = await listMainChatMessages(thread.id).catch(() => []);
    if (messages.length === 0) continue;
    const threadHeader = `[Thread: ${thread.title ?? 'Untitled'}]\n`;
    const msgLines = messages
      .map((m) => `${m.role}: ${(m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}`)
      .join('\n');
    const block = threadHeader + msgLines + '\n\n';
    digest += block.slice(0, CHAR_CAP - digest.length);
    threadCount++;
  }

  if (threadCount === 0) {
    logger.info({ job_id: ctx.jobId, msg: 'No chat history found — skipping proactive main chat' });
    return;
  }

  // Resolve model
  const aiPrefs = await getAIPreferences().catch(() => null);
  const model = (automationPrefs.proactive_main_chat_model as string | undefined)
    ?? aiPrefs?.default_model
    ?? FALLBACK_MODEL;

  // Load + interpolate prompt
  const promptPath = path.join(getPromptsDir(), 'proactive_main_chat_start', 'v1.md');
  let system: string;
  let user: string;
  try {
    const promptTpl = loadPromptFromFile(promptPath);
    const interpolated = interpolatePrompt(promptTpl, {
      today: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      thread_count: String(threadCount),
      chat_digest: digest.trim(),
    });
    system = interpolated.system;
    user = interpolated.user;
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Failed to load proactive_main_chat_start prompt' });
    return;
  }

  // AI call
  let message: string;
  let threadTitle: string;
  try {
    const response = await createChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { message: string; title?: string };
    if (!parsed.message) throw new Error('No message in AI output');
    message = parsed.message;
    threadTitle = parsed.title ?? "Let's chat";
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Proactive main chat AI call failed' });
    return;
  }

  // Create thread + post AI opening message
  const thread = await createMainChatThread({ title: threadTitle, model_id: model });
  await appendMainChatMessage({
    thread_id: thread.id,
    role: 'assistant',
    content: message,
    model_id: model,
  });

  // Deliver notification
  await createMainChatNotification({
    type: 'conversation',
    title: threadTitle,
    preview: message.slice(0, 120),
    payload: { thread_id: thread.id },
  });

  await logAuditEvent({
    actor: 'system',
    action: 'proactive_main_chat_initiated',
    metadata: { thread_id: thread.id, model },
  });

  // Update next fire time (8–16h from now)
  const nextDelay = (8 + Math.random() * 8) * 60 * 60 * 1000;
  await setPreference('proactive_chat.main_chat.next_fire', Date.now() + nextDelay);

  logger.info({ job_id: ctx.jobId, thread_id: thread.id, msg: 'Proactive main chat created' });
}
