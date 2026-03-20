/**
 * Deep Research Scheduler Job Handler
 *
 * Runs periodically (every 60s via setInterval in worker index).
 * Checks for due research schedules, creates new runs, and chains
 * to deep_research_plan for each triggered schedule.
 */

import {
  enqueueJob,
  logAuditEvent,
  getDueResearchSchedules,
  hasActiveResearchRun,
  createResearchRun,
  advanceResearchSchedule,
} from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:deep-research-scheduler' });

export async function deepResearchSchedulerHandler(): Promise<void> {
  const dueSchedules = await getDueResearchSchedules();

  if (dueSchedules.length === 0) {
    return;
  }

  logger.info({ due_count: dueSchedules.length, msg: 'Processing due research schedules' });

  for (const schedule of dueSchedules) {
    // Skip if there's already an active run for this pot
    const active = await hasActiveResearchRun(schedule.pot_id);
    if (active) {
      logger.info({
        schedule_id: schedule.id,
        pot_id: schedule.pot_id,
        msg: 'Active run exists for pot, skipping scheduled trigger',
      });
      continue;
    }

    try {
      // Create a new research run for this schedule
      const run = await createResearchRun({
        pot_id: schedule.pot_id,
        goal_prompt: schedule.goal_prompt,
        config: schedule.config,
      });

      // Advance schedule to next due time
      await advanceResearchSchedule(schedule.pot_id, run.id);

      // Enqueue plan generation
      await enqueueJob({
        job_type: 'deep_research_plan',
        pot_id: schedule.pot_id,
        priority: 80,
        payload: { run_id: run.id },
      });

      await logAuditEvent({
        actor: 'system',
        action: 'research_scheduled_run_created',
        pot_id: schedule.pot_id,
        metadata: {
          schedule_id: schedule.id,
          run_id: run.id,
        },
      });

      logger.info({
        schedule_id: schedule.id,
        run_id: run.id,
        pot_id: schedule.pot_id,
        msg: 'Scheduled research run created',
      });
    } catch (err) {
      logger.error({
        schedule_id: schedule.id,
        pot_id: schedule.pot_id,
        err: err instanceof Error ? err.message : String(err),
        msg: 'Failed to create scheduled research run',
      });
    }
  }
}
