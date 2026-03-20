/**
 * agent_scheduler Job Handler
 *
 * Self-re-enqueuing scheduler (15-min ticks) that:
 * 1. Finds all pots with enabled agent configs
 * 2. For each pot: checks schedule, creates agent run, enqueues agent_heartbeat
 * 3. Re-enqueues itself
 *
 * Bootstrapped on worker startup with 30s delay (after rss's 25s).
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  hasQueuedJobOfType,
  getSystemTimezone,
} from '@links/storage';
import {
  listEnabledAgentConfigs,
  getAgentSchedule,
  upsertAgentSchedule,
  hasActiveAgentRun,
  createAgentRun,
  advanceAgentSchedule,
} from '@links/storage';
import { logAuditEvent } from '@links/storage';

const logger = createLogger({ name: 'job:agent-scheduler' });

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

export async function agentSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Agent scheduler tick' });

  const configs = await listEnabledAgentConfigs();
  const now = Date.now();

  for (const config of configs) {
    if (!config.enabled) continue;

    // Get or create schedule for this pot
    let schedule = await getAgentSchedule(config.pot_id);
    if (!schedule) {
      // Compute next run: daily at delivery_time_local
      const tz = config.timezone ?? getSystemTimezone() ?? 'UTC';
      const nextRun = computeNextRunAt(config.delivery_time_local, tz, now);
      schedule = await upsertAgentSchedule({
        pot_id: config.pot_id,
        enabled: true,
        timezone: tz,
        next_run_at: nextRun,
      });
      logger.info({ pot_id: config.pot_id, next_run_at: nextRun, msg: 'Created agent schedule' });
      continue; // skip until next tick
    }

    if (!schedule.enabled) continue;

    // Check if it's time to run
    if (!schedule.next_run_at || schedule.next_run_at > now) continue;

    // Check kill switch: re-read config (it may have changed)
    if (!config.enabled) {
      logger.info({ pot_id: config.pot_id, msg: 'Agent kill switch — config disabled, skipping run' });
      const tz = config.timezone ?? getSystemTimezone() ?? 'UTC';
      await advanceAgentSchedule(config.pot_id, schedule.last_run_id ?? '', computeNextRunAt(config.delivery_time_local, tz, now));
      continue;
    }

    // Check for active runs
    const active = await hasActiveAgentRun(config.pot_id);
    if (active) {
      logger.info({ pot_id: config.pot_id, msg: 'Active agent run already exists, skipping' });
      continue;
    }

    // Create a new run
    const run = await createAgentRun({
      pot_id: config.pot_id,
      run_type: 'heartbeat',
      schedule_id: schedule.id,
    });

    // Advance the schedule
    const tz = config.timezone ?? getSystemTimezone() ?? 'UTC';
    const nextRun = computeNextRunAt(config.delivery_time_local, tz, now);
    await advanceAgentSchedule(config.pot_id, run.id, nextRun);

    // Enqueue heartbeat
    await enqueueJob({
      job_type: 'agent_heartbeat',
      payload: { run_id: run.id, pot_id: config.pot_id },
      priority: 15,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'agent_run_created',
      pot_id: config.pot_id,
      metadata: { run_id: run.id, run_type: 'heartbeat', triggered_by: 'scheduler' },
    });

    logger.info({ pot_id: config.pot_id, run_id: run.id, next_run_at: nextRun, msg: 'Enqueued agent heartbeat' });
  }

  await reEnqueue();
}

function computeNextRunAt(deliveryTimeLocal: string, tz: string, fromMs: number): number {
  // Parse HH:MM
  const [hStr, mStr] = (deliveryTimeLocal ?? '09:00').split(':');
  const targetHour = Number(hStr ?? 9);
  const targetMinute = Number(mStr ?? 0);

  // Find next occurrence of this time in the given timezone
  const from = new Date(fromMs);

  // Get today's date components in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(from);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 1) - 1;
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 1);
  const curHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const curMin = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

  // Build candidate for today at target time
  const candidate = new Date(from);
  candidate.setFullYear(year, month, day);
  candidate.setHours(0, 0, 0, 0);

  // Offset candidate by target hour/minute in UTC (approximate — timezone offset assumed stable)
  const tzOffset = from.getTime() - new Date(from.toLocaleString('en-US', { timeZone: tz })).getTime();
  const targetMs = Date.UTC(year, month, day) + targetHour * 3600000 + targetMinute * 60000 - tzOffset;

  if (targetMs > fromMs) {
    return targetMs;
  }
  // Already passed today — schedule for tomorrow
  return targetMs + 24 * 60 * 60 * 1000;
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('agent_scheduler'))) {
    await enqueueJob({
      job_type: 'agent_scheduler',
      run_after: Date.now() + 900_000, // 15 min
      priority: 5,
    });
  }
}
