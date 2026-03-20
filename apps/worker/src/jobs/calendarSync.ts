/**
 * calendar_sync Job Handler
 *
 * Deterministic (no AI): reads a date_mentions artifact and upserts rows
 * into calendar_entry_dates for each extracted date.
 *
 * Idempotent: upsertCalendarEntryDate uses ON CONFLICT DO UPDATE, so
 * re-running is always safe.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getEntryById,
  upsertCalendarEntryDate,
  logAuditEvent,
  getDatabase,
} from '@links/storage';
import { DateMentionsArtifactSchema } from '@links/core';

const logger = createLogger({ name: 'job:calendar-sync' });

export async function calendarSyncHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId });

  if (!ctx.entryId) {
    throw new Error('calendar_sync job requires entry_id');
  }

  const artifactId = ctx.payload?.artifact_id as string | undefined;
  if (!artifactId) {
    throw new Error('calendar_sync job requires payload.artifact_id');
  }

  // Load entry (for pot_id)
  const entry = await getEntryById(ctx.entryId);
  if (!entry) {
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  // Load artifact
  const db = getDatabase();
  const artifactRow = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('id', '=', artifactId)
    .where('artifact_type', '=', 'date_mentions')
    .executeTakeFirst();

  if (!artifactRow) {
    logger.warn({ job_id: ctx.jobId, artifact_id: artifactId, msg: 'Artifact not found — skipping' });
    return;
  }

  // Parse payload
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(artifactRow.payload_json);
  } catch {
    throw new Error(`Failed to parse artifact payload for ${artifactId}`);
  }

  const validation = DateMentionsArtifactSchema.safeParse(parsedPayload);
  if (!validation.success) {
    throw new Error(`date_mentions artifact schema invalid: ${validation.error.message}`);
  }

  const { dates } = validation.data;

  // Upsert calendar_entry_dates for each mention
  let syncedCount = 0;
  for (const mention of dates) {
    await upsertCalendarEntryDate({
      entry_id: entry.id,
      pot_id: entry.pot_id,
      date_key: mention.date_key,
      source_kind: 'extracted_date',
      label: mention.label,
      confidence: mention.confidence,
      artifact_id: artifactId,
    });
    syncedCount++;
  }

  logger.info({ job_id: ctx.jobId, entry_id: ctx.entryId, synced_count: syncedCount });

  await logAuditEvent({
    actor: 'system',
    action: 'calendar_sync_completed',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    metadata: {
      artifact_id: artifactId,
      synced_count: syncedCount,
    },
  });
}
