/**
 * Generate Nudges Job Handler
 *
 * Creates MainChat notifications based on trigger events.
 * Each trigger type has a per-scope cooldown to prevent spam.
 *
 * Triggers:
 *   new_entry   → triage nudge when ≥3 unreviewed entries accumulate (6h cooldown)
 *   daily_journal → "journal ready" insight nudge (20h cooldown)
 *   greeting    → time-of-day greeting (24h cooldown)
 */

import type { JobContext } from '@links/storage';
import {
  getDatabase,
  getPreference,
  setPreference,
  createMainChatNotification,
  logAuditEvent,
} from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:generate-nudges' });

// Cooldown durations in milliseconds per trigger type
const COOLDOWN_MS: Record<string, number> = {
  new_entry:     6  * 60 * 60 * 1000,  // 6 hours
  daily_journal: 20 * 60 * 60 * 1000,  // 20 hours
  greeting:      24 * 60 * 60 * 1000,  // 24 hours
  weekly_triage: 5  * 24 * 60 * 60 * 1000, // 5 days
};

interface NudgePayload {
  trigger: 'new_entry' | 'daily_journal' | 'greeting' | 'weekly_triage';
  entry_id?: string;
  pot_id?: string | null;
  journal_id?: string | null;
  date_ymd?: string;
  scope_type?: string;
  scope_id?: string | null;
}

async function isOnCooldown(trigger: string, scopeKey?: string): Promise<boolean> {
  const key = `nudges.cooldown.${trigger}${scopeKey ? `.${scopeKey}` : ''}`;
  const lastFired = await getPreference<number>(key);
  if (!lastFired) return false;
  const ms = COOLDOWN_MS[trigger] ?? 6 * 60 * 60 * 1000;
  return Date.now() - lastFired < ms;
}

async function setCooldown(trigger: string, scopeKey?: string): Promise<void> {
  const key = `nudges.cooldown.${trigger}${scopeKey ? `.${scopeKey}` : ''}`;
  await setPreference(key, Date.now());
}

async function countRecentEntries(potId?: string | null): Promise<number> {
  const db = getDatabase();
  const since = Date.now() - 48 * 60 * 60 * 1000; // last 48 hours
  let query = db
    .selectFrom('entries')
    .select(db.fn.count('id').as('count'))
    .where('created_at', '>=', since);
  if (potId) query = query.where('pot_id', '=', potId);
  const row = await query.executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function generateNudgesHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as unknown as NudgePayload | undefined;
  if (!payload?.trigger) {
    logger.warn({ job_id: ctx.jobId, msg: 'generate_nudges: missing trigger in payload' });
    return;
  }

  const { trigger, pot_id, journal_id, date_ymd, scope_type, scope_id } = payload;
  logger.info({ job_id: ctx.jobId, trigger, pot_id, msg: 'generate_nudges: checking conditions' });

  // ── Triage: new_entry ──────────────────────────────────────────────
  if (trigger === 'new_entry') {
    const scopeKey = pot_id ?? 'global';
    if (await isOnCooldown('new_entry', scopeKey)) {
      logger.info({ job_id: ctx.jobId, trigger, scopeKey, msg: 'Triage cooldown active — skipping' });
      return;
    }

    const count = await countRecentEntries(pot_id);
    if (count < 3) {
      logger.info({ job_id: ctx.jobId, trigger, count, msg: 'Not enough entries for triage nudge' });
      return;
    }

    const title = `${count} new item${count !== 1 ? 's' : ''} ready for review`;
    const preview = `You've captured ${count} items in the last 48 hours. Want to triage or tag them?`;

    await createMainChatNotification({
      type: 'triage',
      title,
      preview,
      payload: { trigger: 'new_entry', pot_id: pot_id ?? null, entry_count: count },
    });
    await setCooldown('new_entry', scopeKey);
    await logAuditEvent({
      actor: 'system',
      action: 'nudge_created',
      pot_id: pot_id ?? undefined,
      metadata: { trigger, type: 'triage', entry_count: count },
    });
    logger.info({ job_id: ctx.jobId, trigger, count, msg: 'Triage nudge created' });
    return;
  }

  // ── Daily journal ready ────────────────────────────────────────────
  if (trigger === 'daily_journal') {
    if (await isOnCooldown('daily_journal')) {
      logger.info({ job_id: ctx.jobId, trigger, msg: 'Journal nudge cooldown active — skipping' });
      return;
    }

    const dateLabel = date_ymd ?? new Date().toISOString().slice(0, 10);
    const scopeLabel = scope_type === 'pot' && scope_id ? 'for your pot' : 'across all pots';

    await createMainChatNotification({
      type: 'insight',
      title: `Daily journal ready — ${dateLabel}`,
      preview: `Your journal ${scopeLabel} has been generated. Open to review today's activity.`,
      payload: {
        trigger: 'daily_journal',
        journal_id: journal_id ?? null,
        date_ymd: dateLabel,
        scope_type: scope_type ?? 'global',
        scope_id: scope_id ?? null,
      },
    });
    await setCooldown('daily_journal');
    await logAuditEvent({
      actor: 'system',
      action: 'nudge_created',
      metadata: { trigger, type: 'insight', date_ymd: dateLabel },
    });
    logger.info({ job_id: ctx.jobId, trigger, date_ymd: dateLabel, msg: 'Journal-ready nudge created' });
    return;
  }

  // ── Greeting ───────────────────────────────────────────────────────
  if (trigger === 'greeting') {
    if (await isOnCooldown('greeting')) {
      logger.info({ job_id: ctx.jobId, trigger, msg: 'Greeting cooldown active — skipping' });
      return;
    }

    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const title = `Good ${timeOfDay}! Ready to pick up where you left off?`;
    const preview = 'Check your inbox or start a new conversation.';

    await createMainChatNotification({
      type: 'greeting',
      title,
      preview,
      payload: { trigger: 'greeting', time_of_day: timeOfDay },
    });
    await setCooldown('greeting');
    await logAuditEvent({
      actor: 'system',
      action: 'nudge_created',
      metadata: { trigger, type: 'greeting', time_of_day: timeOfDay },
    });
    logger.info({ job_id: ctx.jobId, trigger, msg: 'Greeting nudge created' });
    return;
  }

  // ── Weekly triage ─────────────────────────────────────────────────
  if (trigger === 'weekly_triage') {
    if (await isOnCooldown('weekly_triage')) {
      logger.info({ job_id: ctx.jobId, trigger, msg: 'Weekly triage cooldown active — skipping' });
      return;
    }

    const db = getDatabase();
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const row = await db
      .selectFrom('entries')
      .select(db.fn.count('id').as('count'))
      .where('created_at', '>=', since7d)
      .executeTakeFirst();
    const count = Number(row?.count ?? 0);

    if (count === 0) {
      logger.info({ job_id: ctx.jobId, trigger, msg: 'No entries this week — skipping triage nudge' });
      return;
    }

    await createMainChatNotification({
      type: 'triage',
      title: `${count} item${count !== 1 ? 's' : ''} captured this week`,
      preview: `You've captured ${count} items over the past 7 days. Time to review and organise them.`,
      payload: { trigger: 'weekly_triage', entry_count: count },
    });
    await setCooldown('weekly_triage');
    await logAuditEvent({
      actor: 'system',
      action: 'nudge_created',
      metadata: { trigger, type: 'triage', entry_count: count },
    });
    logger.info({ job_id: ctx.jobId, trigger, count, msg: 'Weekly triage nudge created' });
    return;
  }

  logger.warn({ job_id: ctx.jobId, trigger, msg: 'Unknown trigger — no nudge generated' });
}
