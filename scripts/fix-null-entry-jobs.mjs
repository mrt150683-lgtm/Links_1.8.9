/**
 * One-shot utility: cancel all orphaned jobs where entry_id IS NULL
 * for job types that require an entry_id to succeed.
 *
 * These are legacy jobs created before current architecture guards were in place.
 * idleProcessingScan and all current code always pass entry_id correctly,
 * so no new orphans will be created after this cleanup.
 *
 * Usage: node scripts/fix-null-entry-jobs.mjs
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../apps/api/data/links.db');

// All job types that throw "requires entry_id" when entry_id is null
const ENTRY_SCOPED_TYPES = [
  'tag_entry',
  'extract_text',
  'extract_entities',
  'summarize_entry',
  'generate_link_candidates',
  'calendar_sync',
  'extract_dates',
  'dyk_generate_for_entry',
  'parse_youtube_html',
  'transcribe_video',
];

const placeholders = ENTRY_SCOPED_TYPES.map(() => '?').join(',');

const db = new Database(DB_PATH);

// Show breakdown by job_type
const breakdown = db.prepare(
  `SELECT job_type, status, COUNT(*) as count
   FROM processing_jobs
   WHERE entry_id IS NULL
     AND job_type IN (${placeholders})
     AND status IN ('queued','failed','dead')
   GROUP BY job_type, status
   ORDER BY job_type, status`
).all(...ENTRY_SCOPED_TYPES);

if (breakdown.length === 0) {
  console.log('✓ No corrupt entry-scoped jobs found — queue is clean.');
  db.close();
  process.exit(0);
}

const total = breakdown.reduce((n, r) => n + r.count, 0);
console.log(`Found ${total} corrupt job(s) with entry_id IS NULL:\n`);
console.log('  job_type                    status    count');
console.log('  ' + '-'.repeat(50));
for (const r of breakdown) {
  console.log(`  ${r.job_type.padEnd(28)} ${r.status.padEnd(9)} ${r.count}`);
}

// Cancel them all
const result = db.prepare(
  `UPDATE processing_jobs
   SET status = 'canceled', updated_at = ?
   WHERE entry_id IS NULL
     AND job_type IN (${placeholders})
     AND status IN ('queued','failed','dead')`
).run(Date.now(), ...ENTRY_SCOPED_TYPES);

console.log(`\n✓ Cancelled ${result.changes} job(s).`);

// Show remaining queue summary
const remaining = db.prepare(
  `SELECT job_type, status, COUNT(*) as count
   FROM processing_jobs
   WHERE status IN ('queued','failed')
   GROUP BY job_type, status
   ORDER BY count DESC`
).all();

if (remaining.length === 0) {
  console.log('✓ Queue is now empty (no pending/failed jobs).');
} else {
  const remTotal = remaining.reduce((n, r) => n + r.count, 0);
  console.log(`\nRemaining queue (${remTotal} jobs):`);
  console.log('  job_type                    status    count');
  console.log('  ' + '-'.repeat(50));
  for (const r of remaining) {
    console.log(`  ${r.job_type.padEnd(28)} ${r.status.padEnd(9)} ${r.count}`);
  }
}

console.log('\nNext: cd apps/worker && npx tsx src/index.ts --once');
db.close();
