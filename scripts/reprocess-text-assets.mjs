#!/usr/bin/env node
/**
 * Re-enqueue extract_text jobs for doc entries that have an asset but no content_text.
 * Plain JS — avoids ts-node entirely.
 *
 *   node scripts/reprocess-text-assets.mjs
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/links.db');

const db = new Database(DB_PATH);

// Find doc entries with an asset but no extracted text
const entries = db.prepare(`
  SELECT id, pot_id, asset_id
  FROM entries
  WHERE type = 'doc'
    AND asset_id IS NOT NULL
    AND (content_text IS NULL OR content_text = '')
`).all();

if (entries.length === 0) {
  console.log('No entries need reprocessing.');
  db.close();
  process.exit(0);
}

console.log(`Found ${entries.length} doc entries without extracted text. Re-enqueueing...`);

const insert = db.prepare(`
  INSERT INTO processing_jobs
    (id, job_type, status, pot_id, entry_id, priority, attempts, run_after, created_at, updated_at)
  VALUES
    (@id, 'extract_text', 'queued', @pot_id, @entry_id, 60, 0, @now, @now, @now)
`);

const now = Date.now();
for (const entry of entries) {
  const id = randomUUID();
  insert.run({ id, pot_id: entry.pot_id, entry_id: entry.id, now });
  console.log(`  Enqueued extract_text for entry ${entry.id}`);
}

console.log('✓ Done. The worker will process these jobs next idle cycle.');
db.close();
