/**
 * agent_snapshot_cleanup Job Handler
 *
 * Self-re-enqueuing cleanup that runs every 30 minutes to delete
 * expired agent snapshots and their files on disk.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  enqueueJob,
  hasQueuedJobOfType,
  logAuditEvent,
} from '@links/storage';
import { listExpiredAgentSnapshots, deleteAgentSnapshot } from '@links/storage';
import { unlink } from 'node:fs/promises';

const logger = createLogger({ name: 'job:agent-snapshot-cleanup' });

export async function agentSnapshotCleanupHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'Agent snapshot cleanup tick' });

  const expired = await listExpiredAgentSnapshots();

  for (const snapshot of expired) {
    try {
      // Delete the file if it exists
      if (snapshot.encrypted_path) {
        try {
          await unlink(snapshot.encrypted_path);
        } catch {
          // File may already be gone — ignore
        }
      }

      await deleteAgentSnapshot(snapshot.id);

      await logAuditEvent({
        actor: 'system',
        action: 'agent_snapshot_deleted',
        pot_id: snapshot.pot_id,
        metadata: { snapshot_id: snapshot.id, expired_at: snapshot.expires_at },
      });

      logger.info({ snapshot_id: snapshot.id, pot_id: snapshot.pot_id, msg: 'Agent snapshot deleted' });
    } catch (err) {
      logger.error({ snapshot_id: snapshot.id, err, msg: 'Failed to delete agent snapshot' });
    }
  }

  await reEnqueue();
}

async function reEnqueue(): Promise<void> {
  if (!(await hasQueuedJobOfType('agent_snapshot_cleanup'))) {
    await enqueueJob({
      job_type: 'agent_snapshot_cleanup',
      run_after: Date.now() + 30 * 60_000, // 30 min
      priority: 5,
    });
  }
}
