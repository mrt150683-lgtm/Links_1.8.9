/**
 * Weekly Research Digest Job Handler
 *
 * Generates an AI-powered summary of the week's research activity across
 * all pots and delivers it as a 'digest' notification in Main Chat.
 *
 * Triggered every Sunday at 08:00 by the journal cron scheduler.
 */

import * as path from 'node:path';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getDatabase,
  listPots,
  getAIPreferences,
  createMainChatNotification,
  logAuditEvent,
} from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:weekly-research-digest' });

const FALLBACK_MODEL = 'google/gemini-2.5-flash';
const DIGEST_WINDOW_DAYS = 7;
const MAX_ENTRY_PREVIEW_CHARS = 120;
const MAX_ENTRIES_PER_POT = 10;

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

interface DigestOutput {
  headline: string;
  highlights: string[];
  pot_summaries: Array<{ pot_name: string; entry_count: number; top_topics: string[] }>;
}

export async function weeklyResearchDigestHandler(ctx: JobContext): Promise<void> {
  const db = getDatabase();
  const sinceMs = Date.now() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // 1. Get all pots
  const pots = await listPots();
  if (pots.length === 0) {
    logger.info({ job_id: ctx.jobId, msg: 'No pots — weekly digest skipped' });
    return;
  }

  // 2. Gather per-pot stats for the last 7 days
  const potStats: Array<{ name: string; entry_count: number; excerpts: string[] }> = [];
  let totalEntries = 0;

  for (const pot of pots) {
    const rows = await db
      .selectFrom('entries')
      .select(['id', 'content_text'])
      .where('pot_id', '=', pot.id)
      .where('created_at', '>=', sinceMs)
      .orderBy('created_at', 'desc')
      .limit(MAX_ENTRIES_PER_POT)
      .execute()
      .catch(() => [] as any[]);

    if (rows.length === 0) continue;

    totalEntries += rows.length;

    const excerpts = rows.map((r: any) => {
      const raw: string = r.content_text ?? '';
      return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY_PREVIEW_CHARS);
    }).filter(Boolean);

    potStats.push({
      name: pot.name,
      entry_count: rows.length,
      excerpts,
    });
  }

  if (totalEntries === 0) {
    logger.info({ job_id: ctx.jobId, msg: 'No new entries this week — digest skipped' });
    return;
  }

  // 3. Resolve model
  const prefs = await getAIPreferences().catch(() => null);
  const model = prefs?.default_model || FALLBACK_MODEL;

  // 4. Build prompt input
  const potDataText = potStats.map((p) =>
    `Pot: ${p.name} (${p.entry_count} entries)\nExcerpts:\n${p.excerpts.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`,
  ).join('\n\n');

  // 5. Load prompt
  let system: string;
  let user: string;
  try {
    const promptPath = path.join(getPromptsDir(), 'weekly_research_digest', 'v1.md');
    const promptTpl = loadPromptFromFile(promptPath);
    const interpolated = interpolatePrompt(promptTpl, {
      window_days: String(DIGEST_WINDOW_DAYS),
      total_entries: String(totalEntries),
      pot_data: potDataText,
    });
    system = interpolated.system;
    user = interpolated.user;
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Failed to load weekly_research_digest prompt — using fallback' });
    system = 'You are a research digest assistant. Output strictly valid JSON only. No markdown fences.';
    user = `Summarise ${totalEntries} research entries across ${potStats.length} pot(s) from the last ${DIGEST_WINDOW_DAYS} days.\n\n${potDataText}\n\nReturn: {"headline":"...","highlights":["..."],"pot_summaries":[{"pot_name":"...","entry_count":0,"top_topics":["..."]}]}`;
  }

  // 6. Call AI
  let rawContent: string;
  try {
    const response = await createChatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    rawContent = response.choices[0]?.message?.content ?? '';
    if (!rawContent) throw new Error('Empty AI response');
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, msg: 'Weekly research digest AI call failed' });
    return;
  }

  // 7. Parse output
  let digest: DigestOutput;
  try {
    let cleaned = rawContent.trim();
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();
    digest = JSON.parse(cleaned) as DigestOutput;
    if (!digest.headline || !Array.isArray(digest.highlights)) {
      throw new Error('Invalid digest output shape');
    }
  } catch (err) {
    logger.error({ job_id: ctx.jobId, err, raw: rawContent.slice(0, 200), msg: 'Failed to parse digest output' });
    return;
  }

  // 8. Store as notification
  const dateYmd = new Date().toISOString().slice(0, 10);

  await createMainChatNotification({
    type: 'digest',
    title: `Weekly digest — ${dateYmd}`,
    preview: digest.headline.slice(0, 200),
    payload: {
      trigger: 'weekly_research_digest',
      date_ymd: dateYmd,
      headline: digest.headline,
      highlights: digest.highlights,
      pot_summaries: digest.pot_summaries ?? [],
      total_entries: totalEntries,
    },
  });

  await logAuditEvent({
    actor: 'system',
    action: 'weekly_digest_created',
    metadata: { date_ymd: dateYmd, total_entries: totalEntries, pot_count: potStats.length },
  });

  logger.info({
    job_id: ctx.jobId,
    total_entries: totalEntries,
    pot_count: potStats.length,
    msg: 'Weekly research digest created',
  });
}
