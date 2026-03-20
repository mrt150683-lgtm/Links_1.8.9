/**
 * agent_bridge_scheduler Job Handler (Phase G — Cross-pot Bridge)
 *
 * Self-re-enqueuing scheduler that:
 * 1. Finds pots with cross_pot_enabled=true
 * 2. Groups mutually-opted-in pots
 * 3. Creates a cross_pot_bridge run and enqueues heartbeat
 *
 * Runs every 60 minutes (less frequent than single-pot heartbeat).
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  hasQueuedJobOfType,
  logAuditEvent,
} from '@links/storage';
import {
  listEnabledAgentConfigs,
  hasActiveAgentRun,
  createAgentRun,
} from '@links/storage';

const logger = createLogger({ name: 'job:agent-bridge-scheduler' });

export async function agentBridgeSchedulerHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Agent bridge scheduler tick' });

  // Find all pots with cross_pot_enabled
  const allConfigs = await listEnabledAgentConfigs();
  const crossPotConfigs = allConfigs.filter((c) => c.cross_pot_enabled && c.enabled);

  if (crossPotConfigs.length < 2) {
    // Need at least 2 pots to bridge
    await reEnqueue();
    return;
  }

  // For now: simple strategy — all cross_pot_enabled pots form one bridge group
  const potIds = crossPotConfigs.map((c) => c.pot_id);

  // Check if any in the group already has an active bridge run
  for (const config of crossPotConfigs) {
    const active = await hasActiveAgentRun(config.pot_id);
    if (active) {
      logger.info({ pot_id: config.pot_id, msg: 'Active agent run exists — skip bridge' });
      await reEnqueue();
      return;
    }
  }

  // Use the first pot as the primary for the run
  const primaryPotId = crossPotConfigs[0]?.pot_id;
  if (!primaryPotId) {
    await reEnqueue();
    return;
  }

  const run = await createAgentRun({
    pot_id: primaryPotId,
    run_type: 'cross_pot_bridge',
  });

  await enqueueJob({
    job_type: 'agent_heartbeat',
    payload: {
      run_id: run.id,
      pot_id: primaryPotId,
      bridge_pot_ids: potIds,
      is_bridge: true,
    },
    priority: 10,
  });

  await logAuditEvent({
    actor: 'system',
    action: 'agent_bridge_run_created',
    pot_id: primaryPotId,
    metadata: { run_id: run.id, bridge_pot_ids: potIds },
  });

  logger.info({ run_id: run.id, bridge_count: potIds.length, msg: 'Agent bridge run enqueued' });

  await reEnqueue();
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('agent_bridge_scheduler'))) {
    await enqueueJob({
      job_type: 'agent_bridge_scheduler',
      run_after: Date.now() + 60 * 60_000, // 60 min
      priority: 5,
    });
  }
}
