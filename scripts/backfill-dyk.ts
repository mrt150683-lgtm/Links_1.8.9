#!/usr/bin/env node
/**
 * Backfill dyk_generate_for_entry jobs for existing entries that never had DYK generated.
 * Targets entries with content_text >= 50 chars that have no dyk_items yet.
 *
 * Usage:
 *   node --loader ts-node/esm scripts/backfill-dyk.ts [pot_id]
 *   # If pot_id is omitted, processes all pots.
 */
import { getConfig } from '../packages/config/src/index.js';
import { initDatabase, getDatabase, enqueueJob, closeDatabase } from '../packages/storage/src/index.js';

const MIN_CONTENT_LENGTH = 50;

async function main() {
  const potIdArg = process.argv[2] ?? null;
  const config = getConfig();
  initDatabase({ filename: config.DATABASE_PATH });
  const db = getDatabase();

  console.log(potIdArg
    ? `Backfilling DYK for pot: ${potIdArg}`
    : 'Backfilling DYK for ALL pots');

  // Find entries with sufficient content_text that have no dyk_items yet
  let query = db
    .selectFrom('entries as e')
    .leftJoin('dyk_items as d', (join) =>
      join.onRef('d.entry_id', '=', 'e.id').onRef('d.pot_id', '=', 'e.pot_id')
    )
    .select(['e.id', 'e.pot_id', 'e.content_text'])
    .where('d.id', 'is', null) // no dyk_items exist for this entry
    .where('e.content_text', 'is not', null);

  if (potIdArg) {
    query = query.where('e.pot_id', '=', potIdArg) as typeof query;
  }

  const candidates = await query.execute();

  // Further filter by content length (SQLite length() could also work but JS is fine)
  const entries = candidates.filter(
    (e) => e.content_text && e.content_text.length >= MIN_CONTENT_LENGTH
  );

  if (entries.length === 0) {
    console.log('No entries need DYK backfill (all either too short or already processed).');
    closeDatabase();
    return;
  }

  console.log(`Found ${entries.length} entries to backfill. Enqueueing...`);

  let enqueued = 0;
  for (const entry of entries) {
    await enqueueJob({
      job_type: 'dyk_generate_for_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      priority: 3,
    });
    console.log(`  [${++enqueued}/${entries.length}] Enqueued for entry ${entry.id}`);
  }

  console.log(`\n✓ Done — enqueued ${enqueued} dyk_generate_for_entry jobs.`);
  console.log('The worker will process them in the background (priority 3).');
  closeDatabase();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
