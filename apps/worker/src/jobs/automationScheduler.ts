/**
 * automation_scheduler Job Handler
 *
 * Self-re-enqueuing 60s tick that:
 * 1. Reads scheduled_tasks where status=active AND next_run_at <= now AND not locked
 * 2. For each due task: checks quiet hours, run windows, daily caps
 * 3. Claims the task and dispatches to appropriate job type
 * 4. Re-enqueues itself in 60s
 *
 * Bootstrapped on worker startup with 40s delay (after agent_snapshot_cleanup's 35s).
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  hasQueuedJobOfType,
  getSystemTimezone,
  listDueTasks,
  claimScheduledTask,
  releaseScheduledTask,
  updateScheduledTask,
  computeTaskNextRunAt,
  countHeartbeatRunsToday,
  countTaskCreationsToday,
  getAutomationSettings,
  logAuditEvent,
} from '@links/storage';

const logger = createLogger({ name: 'job:automation-scheduler' });

function getLocalHourMinute(date: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

function isInQuietHours(
  quietHours: { from: string; to: string } | null,
  tz: string,
): boolean {
  if (!quietHours) return false;
  const now = new Date();
  const { hour, minute } = getLocalHourMinute(now, tz);
  const nowTotal = hour * 60 + minute;

  const [fromH, fromM] = quietHours.from.split(':').map(Number);
  const [toH, toM] = quietHours.to.split(':').map(Number);
  const fromTotal = (fromH ?? 0) * 60 + (fromM ?? 0);
  const toTotal = (toH ?? 0) * 60 + (toM ?? 0);

  if (fromTotal <= toTotal) {
    return nowTotal >= fromTotal && nowTotal < toTotal;
  }
  // Overnight range (e.g. 22:00–06:00)
  return nowTotal >= fromTotal || nowTotal < toTotal;
}

export async function automationSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Automation scheduler tick' });

  const now = Date.now();
  const dueTasks = await listDueTasks(now);

  logger.info({ count: dueTasks.length, msg: 'Automation scheduler: due tasks found' });

  const workerId = `automation-scheduler-${ctx.jobId}`;

  for (const task of dueTasks) {
    try {
      // Load automation settings for this pot
      const settings = await getAutomationSettings(task.pot_id);
      if (!settings || !settings.enabled) {
        logger.info({ task_id: task.id, pot_id: task.pot_id, msg: 'Automation disabled for pot — skipping task' });
        continue;
      }

      const tz = settings.timezone ?? getSystemTimezone() ?? 'UTC';

      // Check quiet hours
      if (isInQuietHours(settings.quiet_hours ?? null, tz)) {
        logger.info({ task_id: task.id, msg: 'In quiet hours — skipping task' });
        continue;
      }

      // Check heartbeat-specific caps
      if (task.task_type === 'heartbeat') {
        if (!settings.heartbeat_enabled) {
          logger.info({ task_id: task.id, msg: 'Heartbeat not enabled for pot — skipping' });
          continue;
        }
        const todayCount = await countHeartbeatRunsToday(task.pot_id);
        if (todayCount >= settings.max_heartbeat_runs_per_day) {
          logger.info({ task_id: task.id, today_count: todayCount, max: settings.max_heartbeat_runs_per_day, msg: 'Heartbeat daily cap reached' });
          continue;
        }
      }

      // Atomic claim
      const claimed = await claimScheduledTask(task.id, workerId);
      if (!claimed) {
        logger.info({ task_id: task.id, msg: 'Task already claimed by another worker — skipping' });
        continue;
      }

      // Dispatch to appropriate job
      try {
        let jobType: string;
        switch (task.task_type) {
          case 'heartbeat':
            jobType = 'heartbeat_generate';
            break;
          case 'deep_research_run':
            jobType = 'deep_research_plan';
            break;
          case 'journal_daily':
            jobType = 'build_daily_journal_note';
            break;
          default:
            jobType = 'task_execute';
        }

        await enqueueJob({
          job_type: jobType,
          pot_id: task.pot_id,
          payload: {
            scheduled_task_id: task.id,
            pot_id: task.pot_id,
            task_type: task.task_type,
            task_payload: task.payload,
          },
          priority: task.priority,
        });

        // Compute next run
        const nextRunAt = task.schedule_kind === 'once'
          ? null
          : computeTaskNextRunAt(task.cron_like, tz, now);

        await updateScheduledTask(task.id, {
          last_run_at: now,
          ...(nextRunAt !== null ? { next_run_at: nextRunAt } : { status: 'completed', next_run_at: null }),
          locked_by: null,
          locked_at: null,
        });

        await logAuditEvent({
          actor: 'system',
          action: 'automation_task_dispatched',
          pot_id: task.pot_id,
          metadata: { task_id: task.id, task_type: task.task_type, job_type: jobType, next_run_at: nextRunAt },
        });

        logger.info({ task_id: task.id, pot_id: task.pot_id, job_type: jobType, msg: 'Automation task dispatched' });
      } catch (dispatchErr) {
        // Release lock on dispatch failure
        await releaseScheduledTask(task.id);
        logger.error({ task_id: task.id, err: String(dispatchErr), msg: 'Failed to dispatch automation task' });
      }
    } catch (taskErr) {
      logger.error({ task_id: task.id, err: String(taskErr), msg: 'Error processing automation task' });
    }
  }

  await reEnqueue();
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('automation_scheduler'))) {
    await enqueueJob({
      job_type: 'automation_scheduler',
      run_after: Date.now() + 60_000, // 60s tick
      priority: 5,
    });
  }
}
