/**
 * Journal Module: Startup backfill scheduler
 *
 * On worker startup, checks for missing daily notes from recent days and
 * enqueues build_daily_journal_note jobs (below capture priority).
 */

import { getPreference, enqueueJob, listPots, getJournalEntry } from '@links/storage';
import type { JournalConfig } from '@links/storage';
import { createLogger } from '@links/logging';
import { yesterdayYmd, formatYmd } from './jobs/utils/journalUtils.js';

const logger = createLogger({ name: 'journal-scheduler' });
const PROCESSING_CONFIG_KEY = 'processing.config';

export async function scheduleJournalBackfillIfEnabled(runOnce = false): Promise<void> {
  try {
    if (runOnce) {
      logger.info({ msg: 'Run-once mode — skipping journal backfill scheduler' });
      return;
    }

    const processingConfig = await getPreference<{ journal?: JournalConfig }>(PROCESSING_CONFIG_KEY);
    const journalConfig = processingConfig?.journal;

    if (!journalConfig?.enabled) {
      logger.info({ msg: 'Journal disabled — skipping backfill scheduler' });
      return;
    }

    const scopeGlobal = journalConfig.scopes?.global ?? true;
    const scopePots = journalConfig.scopes?.pots ?? true;
    const maxJobs = journalConfig.budgets?.max_jobs_per_startup_backfill ?? 7;

    let enqueued = 0;

    // Build list of dates to check (yesterday + up to 6 more recent days)
    const datesToCheck: string[] = [];
    const today = new Date();
    for (let i = 1; i <= 7 && datesToCheck.length < 7; i++) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      datesToCheck.push(formatYmd(d));
    }

    // Helper to enqueue if missing
    const enqueueIfMissing = async (
      date_ymd: string,
      scope_type: 'global' | 'pot',
      scope_id: string | null,
    ): Promise<boolean> => {
      if (enqueued >= maxJobs) return false;

      const existing = await getJournalEntry({
        kind: 'daily',
        scope_type,
        scope_id,
        period_start_ymd: date_ymd,
      });

      if (!existing) {
        await enqueueJob({
          job_type: 'build_daily_journal_note',
          pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
          priority: -5, // lower than capture/ingest priority 0
          payload: {
            kind: 'daily',
            scope_type,
            scope_id,
            date_ymd,
            timezone: 'UTC',
          },
        });
        enqueued++;
        logger.info({ date_ymd, scope_type, scope_id, msg: 'Enqueued missing daily journal note' });
        return true;
      }

      return false;
    };

    // Check global scope
    if (scopeGlobal) {
      for (const date_ymd of datesToCheck) {
        if (enqueued >= maxJobs) break;
        await enqueueIfMissing(date_ymd, 'global', null);
      }
    }

    // Check per-pot scope
    if (scopePots && enqueued < maxJobs) {
      const pots = await listPots();
      for (const pot of pots) {
        for (const date_ymd of datesToCheck) {
          if (enqueued >= maxJobs) break;
          await enqueueIfMissing(date_ymd, 'pot', pot.id);
        }
        if (enqueued >= maxJobs) break;
      }
    }

    logger.info({
      enqueued,
      max_jobs: maxJobs,
      msg: `Journal backfill scheduler: ${enqueued} job(s) enqueued`,
    });
  } catch (error) {
    // Scheduler errors must never crash the worker
    logger.error({ err: error, msg: 'Journal backfill scheduler error (non-fatal)' });
  }
}
