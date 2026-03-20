/**
 * dyk_inbox_tick Job Handler
 *
 * Self-re-enqueuing scheduler (every 5 minutes).
 * For each pot: if interval has elapsed, surfaces one eligible DYK item
 * as a per-pot notification and advances the next_dyk_due_at timer.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  listPots,
  enqueueJob,
  hasQueuedJobOfType,
  logAuditEvent,
  getNextEligibleDyk,
  updateDykItemStatus,
  incrementDykShownCount,
  createDykNotification,
  getPotDykState,
  setPotDykState,
} from '@links/storage';

const logger = createLogger({ name: 'job:dyk-inbox-tick' });

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_INTERVAL_HOURS = 4;

export async function dykInboxTickHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'dyk_inbox_tick starting' });

  const now = Date.now();

  // 1. Load all pots
  const pots = await listPots(500, 0);

  for (const pot of pots) {
    try {
      // 2. Read DYK state
      const state = await getPotDykState(pot.id);
      const intervalHours = state.interval_hours ?? DEFAULT_INTERVAL_HOURS;
      const nextDue = state.next_dyk_due_at ?? 0;

      // 3. Check if interval has elapsed
      if (now < nextDue) {
        continue; // Not time yet for this pot
      }

      // 4. Get next eligible DYK item
      const dyk = await getNextEligibleDyk(pot.id);
      if (!dyk) {
        // No items ready — still advance the timer slightly to avoid spin
        continue;
      }

      // 5. Update item status to 'shown' and increment shown_count
      await updateDykItemStatus(dyk.id, 'shown');
      await incrementDykShownCount(dyk.id);

      // 6. Create notification
      await createDykNotification({
        pot_id: pot.id,
        dyk_id: dyk.id,
        title: dyk.title,
        body: dyk.body,
      });

      // 7. Advance timer
      await setPotDykState(pot.id, {
        next_dyk_due_at: now + intervalHours * 3_600_000,
        interval_hours: intervalHours,
      });

      // 8. Audit log
      await logAuditEvent({
        actor: 'system',
        action: 'dyk_shown',
        pot_id: pot.id,
        metadata: { dyk_id: dyk.id, pot_id: pot.id },
      });

      logger.info({ job_id: ctx.jobId, pot_id: pot.id, dyk_id: dyk.id, msg: 'DYK notification created' });
    } catch (err) {
      // Don't fail the entire tick for one pot error
      logger.error({
        job_id: ctx.jobId,
        pot_id: pot.id,
        error: err instanceof Error ? err.message : String(err),
        msg: 'Error processing pot DYK tick',
      });
    }
  }

  // 9. Self-re-enqueue in 5 minutes — only if no successor already queued
  if (!(await hasQueuedJobOfType('dyk_inbox_tick'))) {
    await enqueueJob({
      job_type: 'dyk_inbox_tick',
      run_after: Date.now() + TICK_INTERVAL_MS,
      priority: 5,
    });
  }

  logger.info({ job_id: ctx.jobId, pot_count: pots.length, msg: 'dyk_inbox_tick complete' });
}
