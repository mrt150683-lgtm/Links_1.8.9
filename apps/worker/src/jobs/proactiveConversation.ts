/**
 * proactiveConversation
 *
 * Creates an agent-initiated chat thread with an AI opening message and
 * sends a 'conversation' notification to the user. The scheduler
 * (journalCronScheduler) fires this at a randomised interval (8–16h).
 */

import * as path from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getDatabase,
  getAutomationSettings,
  listPots,
  getAIPreferences,
  createMainChatThread,
  appendMainChatMessage,
  createMainChatNotification,
  getLatestHeartbeatSnapshot,
  logAuditEvent,
  getSystemTimezone,
} from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:proactive-conversation' });
const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

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

function isInQuietHours(quietHours: { from: string; to: string } | null, tz: string): boolean {
  if (!quietHours) return false;
  const hour = localHour(tz);
  const [fromH] = quietHours.from.split(':').map(Number);
  const [toH] = quietHours.to.split(':').map(Number);
  if (fromH! <= toH!) return hour >= fromH! && hour < toH!;
  return hour >= fromH! || hour < toH!; // overnight window
}

export async function proactiveConversationHandler(ctx: JobContext): Promise<void> {
  const { pot_id: potId } = ctx.payload as { pot_id: string };

  // Load settings and verify still enabled
  const settings = await getAutomationSettings(potId);
  if (!settings?.enabled || !settings.proactive_conversations_enabled) {
    logger.info({ job_id: ctx.jobId, pot_id: potId, msg: 'Proactive conversations disabled — skipping' });
    return;
  }

  // Respect quiet hours + hard block before 08:00
  const tz = settings.timezone ?? getSystemTimezone() ?? 'UTC';
  if (isInQuietHours(settings.quiet_hours, tz)) {
    logger.info({ job_id: ctx.jobId, pot_id: potId, msg: 'Quiet hours — proactive conversation skipped' });
    return;
  }
  if (localHour(tz) < 8) {
    logger.info({ job_id: ctx.jobId, pot_id: potId, msg: 'Night hours (< 08:00) — proactive conversation skipped' });
    return;
  }

  // Load pot
  const pots = await listPots();
  const pot = pots.find((p) => p.id === potId);
  if (!pot) {
    logger.warn({ job_id: ctx.jobId, pot_id: potId, msg: 'Pot not found — skipping proactive conversation' });
    return;
  }

  // Build digest: recent entries (last 7 days)
  const db = getDatabase();
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recentEntries = await db
    .selectFrom('entries')
    .select(['id', 'content_text'])
    .where('pot_id', '=', potId)
    .where('created_at', '>=', sinceMs)
    .orderBy('created_at', 'desc')
    .limit(5)
    .execute()
    .catch(() => [] as Array<{ id: string; content_text: string }>);

  // Extract tags from derived_artifacts for recent entries
  const entryIds = recentEntries.map((e) => e.id).filter(Boolean);
  const tagCounts: Record<string, number> = {};
  if (entryIds.length > 0) {
    const tagArtifacts = await db
      .selectFrom('derived_artifacts')
      .select('payload_json')
      .where('entry_id', 'in', entryIds)
      .where('artifact_type', '=', 'tags')
      .execute()
      .catch(() => [] as Array<{ payload_json: string | null }>);
    for (const art of tagArtifacts) {
      try {
        const payload = typeof art.payload_json === 'string'
          ? JSON.parse(art.payload_json)
          : art.payload_json;
        const tags: string[] = Array.isArray(payload?.tags) ? payload.tags : [];
        tags.forEach((t) => { tagCounts[t] = (tagCounts[t] ?? 0) + 1; });
      } catch { /* skip */ }
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);

  const heartbeat = await getLatestHeartbeatSnapshot(potId).catch(() => null);
  const heartbeatContext = heartbeat
    ? `**Current pot status:** ${(heartbeat.snapshot as any)?.headline ?? 'No headline'}`
    : '';

  const entriesText = recentEntries.length > 0
    ? recentEntries
        .map((e, i) => `${i + 1}. ${(e.content_text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}`)
        .join('\n')
    : 'No entries in the last 7 days.';

  // Resolve model + load prompt
  const prefs = await getAIPreferences().catch(() => null);
  const model = settings.proactive_conversation_model
    ?? settings.default_model
    ?? prefs?.default_model
    ?? FALLBACK_MODEL;

  const promptPath = path.join(getPromptsDir(), 'proactive_conversation_start', 'v1.md');
  let system: string;
  let user: string;
  try {
    const promptTpl = loadPromptFromFile(promptPath);
    const interpolated = interpolatePrompt(promptTpl, {
      pot_name: pot.name,
      recent_entries: entriesText,
      top_tags: topTags.length > 0 ? topTags.join(', ') : 'No tags yet',
      heartbeat_context: heartbeatContext,
    });
    system = interpolated.system;
    user = interpolated.user;
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Failed to load proactive_conversation_start prompt' });
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
      temperature: 0.6,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { message: string; title?: string };
    if (!parsed.message) throw new Error('No message in AI output');
    message = parsed.message;
    threadTitle = parsed.title ?? `${pot.name} — insight`;
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Proactive conversation AI call failed' });
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

  // Deliver notification pointing to the thread
  await createMainChatNotification({
    type: 'conversation',
    title: `${pot.name} — ${threadTitle}`,
    preview: message.slice(0, 120),
    payload: { thread_id: thread.id, pot_id: potId, pot_name: pot.name },
  });

  await logAuditEvent({
    actor: 'system',
    action: 'proactive_conversation_initiated',
    pot_id: potId,
    metadata: { thread_id: thread.id, model },
  });

  logger.info({
    job_id: ctx.jobId,
    pot_id: potId,
    thread_id: thread.id,
    msg: 'Proactive conversation created',
  });
}
