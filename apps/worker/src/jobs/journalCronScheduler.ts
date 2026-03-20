/**
 * Journal / System Cron Scheduler
 *
 * Self-re-enqueuing job (every 30 min) that fires scheduled tasks at their
 * configured local times. Each task has its own idempotency key so it fires
 * at most once per calendar day.
 *
 * Schedule overview:
 *   04:00 daily      → rss_cleanup
 *   03:00 Monday     → refresh_models  (weekly model list refresh)
 *   02:00 Sunday     → dictionize_user_style  (writing-style recalibration)
 *   17:00 Friday     → generate_nudges / weekly_triage
 *   08:00 Sunday     → weekly_research_digest
 *   23:50 daily      → journal generation (daily/weekly/monthly/quarterly/yearly)
 */

import type { JobContext } from '@links/storage';
import {
  getPreference,
  setPreference,
  enqueueJob,
  listPots,
  getSystemTimezone,
  getDatabase,
  listEnabledProactivePots,
} from '@links/storage';
import type { PotAutomationSettings } from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:journal-cron-scheduler' });

const REQUEUE_DELAY_MS = 30 * 60 * 1000; // 30 minutes
const PROCESSING_CONFIG_KEY = 'processing.config';
const JOURNAL_TRIGGER_HOUR = 23;
const JOURNAL_TRIGGER_MIN_FLOOR = 50;

// ── Date / time helpers ───────────────────────────────────────────────

/** Returns YYYY-MM-DD for the current date in the given timezone */
function localDateYmd(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** Returns current { hour, minute } in the given timezone */
function localTime(tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  return {
    hour:   parseInt(parts.find((p) => p.type === 'hour')?.value   ?? '0', 10),
    minute: parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10),
  };
}

/** Day of week for ymd (0=Sun … 6=Sat) */
function dayOfWeek(ymd: string): number {
  return new Date(ymd + 'T12:00:00Z').getUTCDay();
}

/** Monday of the ISO week containing ymd (YYYY-MM-DD) */
function weekMondayYmd(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-01 for the month containing ymd */
function monthStartYmd(ymd: string): string {
  return ymd.slice(0, 7) + '-01';
}

/** Last calendar day of the month of ymd (YYYY-MM-DD) */
function monthEndYmd(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Is ymd the last day of its month? */
function isLastDayOfMonth(ymd: string): boolean {
  return ymd === monthEndYmd(ymd);
}

/** Is ymd a Sunday? */
function isSunday(ymd: string): boolean {
  return new Date(ymd + 'T12:00:00Z').getUTCDay() === 0;
}

/** Is ymd the last day of a quarter (Mar/Jun/Sep/Dec)? */
function isLastDayOfQuarter(ymd: string): boolean {
  const month = parseInt(ymd.split('-')[1]!, 10);
  return isLastDayOfMonth(ymd) && [3, 6, 9, 12].includes(month);
}

/** Is ymd Dec 31? */
function isLastDayOfYear(ymd: string): boolean {
  return ymd.endsWith('-12-31');
}

/** First day of the quarter containing ymd */
function quarterStartYmd(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0');
  return `${y}-${qm}-01`;
}

// ── Idempotency helpers ───────────────────────────────────────────────

/** Returns true if this cron key has already fired today — does NOT mark it. */
async function hasRunToday(cronKey: string, todayYmd: string): Promise<boolean> {
  const lastYmd = await getPreference<string>(`cron.${cronKey}.last_triggered_ymd`);
  return lastYmd === todayYmd;
}

/** Marks a cron key as fired today. */
async function markRanToday(cronKey: string, todayYmd: string): Promise<void> {
  await setPreference(`cron.${cronKey}.last_triggered_ymd`, todayYmd);
}

// ── Handler ───────────────────────────────────────────────────────────

export async function journalCronSchedulerHandler(ctx: JobContext): Promise<void> {
  // Always re-enqueue first so the scheduler survives any error below
  await enqueueJob({
    job_type: 'journal_cron_scheduler',
    run_after: Date.now() + REQUEUE_DELAY_MS,
    priority: 5,
  });

  const tz = getSystemTimezone() ?? 'UTC';
  const { hour, minute } = localTime(tz);
  const todayYmd = localDateYmd(tz);
  const dow = dayOfWeek(todayYmd); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat

  // ── G: Proactive conversation check (every 30 min, per enabled pot) ─
  const proactivePots = await listEnabledProactivePots().catch(() => [] as PotAutomationSettings[]);
  for (const pot of proactivePots) {
    const nextFireKey = `proactive_chat.next_fire.${pot.pot_id}`;
    const nextFireAt = await getPreference<number>(nextFireKey);

    if (nextFireAt === null || nextFireAt === undefined) {
      // First enable — schedule initial fire 4–12h from now
      const delayMs = (4 + Math.random() * 8) * 60 * 60 * 1000;
      await setPreference(nextFireKey, Date.now() + delayMs);
      continue;
    }

    if (Date.now() < nextFireAt) continue;

    // Time to fire — enqueue job and randomise next fire (8–16h from now)
    await enqueueJob({
      job_type: 'proactive_conversation',
      payload: { pot_id: pot.pot_id },
      priority: 10,
    }).catch((e) => logger.warn({ err: e, pot_id: pot.pot_id, msg: 'Failed to enqueue proactive_conversation' }));

    const nextDelay = (8 + Math.random() * 8) * 60 * 60 * 1000;
    await setPreference(nextFireKey, Date.now() + nextDelay);
    logger.info({ job_id: ctx.jobId, pot_id: pot.pot_id, msg: 'Cron: enqueued proactive_conversation' });
  }

  // ── H: Proactive main-chat check (global, every 30 min) ──────────────────
  const mainChatPrefs = await getPreference<Record<string, unknown>>('automation.prefs') ?? {};
  if (mainChatPrefs.proactive_main_chat_enabled === true) {
    const mainChatFireAt = await getPreference<number>('proactive_chat.main_chat.next_fire');
    if (mainChatFireAt === null || mainChatFireAt === undefined) {
      // First enable — schedule 4–12h from now
      const delayMs = (4 + Math.random() * 8) * 60 * 60 * 1000;
      await setPreference('proactive_chat.main_chat.next_fire', Date.now() + delayMs);
    } else if (Date.now() >= mainChatFireAt) {
      await enqueueJob({ job_type: 'proactive_main_chat', payload: {}, priority: 10 })
        .catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue proactive_main_chat' }));
      // Safety fallback — job itself also updates next_fire
      const nextDelay = (8 + Math.random() * 8) * 60 * 60 * 1000;
      await setPreference('proactive_chat.main_chat.next_fire', Date.now() + nextDelay);
      logger.info({ job_id: ctx.jobId, msg: 'Cron: enqueued proactive_main_chat' });
    }
  }

  // ── A: Daily RSS cleanup at 04:00 ─────────────────────────────────
  if (hour === 4 && minute < 30 && !(await hasRunToday('rss_cleanup', todayYmd))) {
    await markRanToday('rss_cleanup', todayYmd);
    await enqueueJob({ job_type: 'rss_cleanup', priority: 3 })
      .catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue rss_cleanup' }));
    logger.info({ job_id: ctx.jobId, msg: 'Cron: enqueued rss_cleanup (daily 04:00)' });
  }

  // ── B: Weekly model refresh (Monday 03:00) ─────────────────────────
  if (dow === 1 && hour === 3 && minute < 30 && !(await hasRunToday('model_refresh', todayYmd))) {
    await markRanToday('model_refresh', todayYmd);
    await enqueueJob({ job_type: 'refresh_models', priority: 3 })
      .catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue refresh_models' }));
    logger.info({ job_id: ctx.jobId, msg: 'Cron: enqueued refresh_models (Monday 03:00)' });
  }

  // ── C: Weekly dictionize recalibration (Sunday 02:00) ─────────────
  if (dow === 0 && hour === 2 && minute < 30 && !(await hasRunToday('dictionize_recalibrate', todayYmd))) {
    await markRanToday('dictionize_recalibrate', todayYmd);
    const db = getDatabase();
    const recentThread = await db
      .selectFrom('main_chat_threads')
      .select('id')
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst()
      .catch(() => null);
    if (recentThread) {
      await enqueueJob({
        job_type: 'dictionize_user_style',
        payload: { thread_id: recentThread.id },
        priority: 3,
      }).catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue dictionize recalibration' }));
      logger.info({ job_id: ctx.jobId, thread_id: recentThread.id, msg: 'Cron: enqueued dictionize recalibration (Sunday 02:00)' });
    }
  }

  // ── D: Weekly triage nudge (Friday 17:00) ─────────────────────────
  if (dow === 5 && hour === 17 && minute < 30 && !(await hasRunToday('weekly_triage', todayYmd))) {
    await markRanToday('weekly_triage', todayYmd);
    await enqueueJob({
      job_type: 'generate_nudges',
      priority: 5,
      payload: { trigger: 'weekly_triage' },
    }).catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue weekly triage nudge' }));
    logger.info({ job_id: ctx.jobId, msg: 'Cron: enqueued weekly triage nudge (Friday 17:00)' });
  }

  // ── F: Weekly research digest (Sunday 08:00) ──────────────────────
  if (dow === 0 && hour === 8 && minute < 30 && !(await hasRunToday('weekly_research_digest', todayYmd))) {
    await markRanToday('weekly_research_digest', todayYmd);
    await enqueueJob({ job_type: 'weekly_research_digest', priority: 3 })
      .catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue weekly_research_digest' }));
    logger.info({ job_id: ctx.jobId, msg: 'Cron: enqueued weekly research digest (Sunday 08:00)' });
  }

  // ── Journal cron (daily 23:50–23:59) ──────────────────────────────
  // Check journal is enabled
  const cfg = await getPreference<{ journal?: { enabled?: boolean; scopes?: { global?: boolean; pots?: boolean } } }>(
    PROCESSING_CONFIG_KEY,
  );
  if (!cfg?.journal?.enabled) {
    return;
  }

  if (hour !== JOURNAL_TRIGGER_HOUR || minute < JOURNAL_TRIGGER_MIN_FLOOR) {
    return;
  }

  // Idempotency guard — fire at most once per calendar day
  // (keep legacy key for backward compat with any existing state)
  const lastJournalYmd = await getPreference<string>('journal_cron.last_triggered_ymd');
  if (lastJournalYmd === todayYmd) {
    logger.info({ job_id: ctx.jobId, todayYmd, msg: 'Journal cron already ran today — skipping' });
    return;
  }
  await setPreference('journal_cron.last_triggered_ymd', todayYmd);

  logger.info({ job_id: ctx.jobId, todayYmd, tz, msg: 'Journal cron firing' });

  const scopeGlobal = cfg.journal.scopes?.global ?? true;
  const scopePots   = cfg.journal.scopes?.pots   ?? true;
  const pots        = scopePots ? await listPots() : [];

  // ── Helper: enqueue a rollup for all active scopes ─────────────────
  const enqueueRollup = async (
    jobType: string,
    kind: string,
    periodStart: string,
    periodEnd: string,
  ) => {
    if (scopeGlobal) {
      await enqueueJob({
        job_type: jobType,
        priority: -3,
        payload: { kind, scope_type: 'global', scope_id: null, period_start_ymd: periodStart, period_end_ymd: periodEnd, timezone: tz },
      }).catch((e) => logger.warn({ err: e, kind, msg: 'Failed to enqueue global rollup' }));
    }
    for (const pot of pots) {
      await enqueueJob({
        job_type: jobType,
        pot_id: pot.id,
        priority: -3,
        payload: { kind, scope_type: 'pot', scope_id: pot.id, period_start_ymd: periodStart, period_end_ymd: periodEnd, timezone: tz },
      }).catch((e) => logger.warn({ err: e, kind, pot_id: pot.id, msg: 'Failed to enqueue pot rollup' }));
    }
  };

  // ── Yearly (Dec 31) ───────────────────────────────────────────────
  if (isLastDayOfYear(todayYmd)) {
    await enqueueRollup('build_yearly_journal_summary', 'yearly', todayYmd.slice(0, 4) + '-01-01', todayYmd);
    logger.info({ job_id: ctx.jobId, msg: 'Journal cron: enqueued yearly summary' });
  }

  // ── Quarterly (Mar 31 / Jun 30 / Sep 30 — not Dec 31, handled above) ──
  if (isLastDayOfQuarter(todayYmd) && !isLastDayOfYear(todayYmd)) {
    await enqueueRollup('build_quarterly_journal_summary', 'quarterly', quarterStartYmd(todayYmd), todayYmd);
    logger.info({ job_id: ctx.jobId, msg: 'Journal cron: enqueued quarterly summary' });
  }

  // ── Monthly (last calendar day) ───────────────────────────────────
  if (isLastDayOfMonth(todayYmd)) {
    await enqueueRollup('build_monthly_journal_summary', 'monthly', monthStartYmd(todayYmd), todayYmd);
    logger.info({ job_id: ctx.jobId, msg: 'Journal cron: enqueued monthly summary' });
  }

  // ── Weekly (Sunday) ───────────────────────────────────────────────
  if (isSunday(todayYmd)) {
    await enqueueRollup('build_weekly_journal_summary', 'weekly', weekMondayYmd(todayYmd), todayYmd);
    logger.info({ job_id: ctx.jobId, msg: 'Journal cron: enqueued weekly summary' });
  }

  // ── Daily (every day, always) ─────────────────────────────────────
  if (scopeGlobal) {
    await enqueueJob({
      job_type: 'build_daily_journal_note',
      priority: -3,
      payload: { kind: 'daily', scope_type: 'global', scope_id: null, date_ymd: todayYmd, timezone: tz },
    }).catch((e) => logger.warn({ err: e, msg: 'Failed to enqueue global daily note' }));
  }
  for (const pot of pots) {
    await enqueueJob({
      job_type: 'build_daily_journal_note',
      pot_id: pot.id,
      priority: -3,
      payload: { kind: 'daily', scope_type: 'pot', scope_id: pot.id, date_ymd: todayYmd, timezone: tz },
    }).catch((e) => logger.warn({ err: e, pot_id: pot.id, msg: 'Failed to enqueue pot daily note' }));
  }

  // ── Journal-ready nudge ───────────────────────────────────────────
  await enqueueJob({
    job_type: 'generate_nudges',
    priority: 5,
    payload: { trigger: 'daily_journal', date_ymd: todayYmd, scope_type: 'global', scope_id: null },
  }).catch(() => { /* non-fatal */ });

  logger.info({ job_id: ctx.jobId, todayYmd, msg: 'Journal cron: all jobs enqueued successfully' });
}
