#!/usr/bin/env node
/**
 * Re-enqueue extract_text jobs for doc entries that have an asset but no content_text.
 * Run this after adding .md / .txt support to the extractText worker.
 *
 *   node --loader ts-node/esm scripts/reprocess-text-assets.ts
 */
import { getConfig } from '../packages/config/src/index.js';
import { initDatabase, getDatabase, enqueueJob, closeDatabase } from '../packages/storage/src/index.js';

async function main() {
  const config = getConfig();
  initDatabase({ filename: config.DATABASE_PATH });
  const db = getDatabase();

  // Find all doc entries that have an asset but no extracted text yet
  const entries = await db
    .selectFrom('entries')
    .select(['id', 'pot_id', 'asset_id'])
    .where('type', '=', 'doc')
    .where('asset_id', 'is not', null)
    .where((eb) => eb.or([
      eb('content_text', 'is', null),
      eb('content_text', '=', ''),
    ]))
    .execute();

  if (entries.length === 0) {
    console.log('No entries need reprocessing.');
    closeDatabase();
    return;
  }

  console.log(`Found ${entries.length} doc entries without extracted text. Re-enqueueing...`);

  for (const entry of entries) {
    await enqueueJob({
      job_type: 'extract_text',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 60,
    });
    console.log(`  Enqueued extract_text for entry ${entry.id}`);
  }

  console.log('✓ Done. Restart the worker to process the jobs.');
  closeDatabase();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
