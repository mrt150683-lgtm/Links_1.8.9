/**
 * RSS Cleanup Job Handler
 *
 * Purges RSS articles older than the configured retention window.
 * Scheduled daily at 04:00 by the journal cron scheduler.
 */

import type { JobContext } from '@links/storage';
import { getRssSettings, pruneOldRssArticles } from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:rss-cleanup' });

const DEFAULT_RETENTION_DAYS = 30;

export async function rssCleanupHandler(ctx: JobContext): Promise<void> {
  const settings = await getRssSettings().catch(() => null);

  if (!settings?.enabled) {
    logger.info({ job_id: ctx.jobId, msg: 'RSS not enabled — cleanup skipped' });
    return;
  }

  const retentionDays = (settings as any).retention_days ?? DEFAULT_RETENTION_DAYS;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const deleted = await pruneOldRssArticles(cutoffMs);

  logger.info({
    job_id: ctx.jobId,
    retention_days: retentionDays,
    deleted,
    msg: 'RSS cleanup complete',
  });
}
