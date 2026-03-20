#!/usr/bin/env node
'use strict';
/**
 * Re-enqueue extract_text jobs for doc entries that have an asset but no content_text.
 * Run from repo root: node scripts/reprocess-text-assets.cjs
 */
const path = require('path');
const { randomUUID } = require('crypto');

// Resolve better-sqlite3 from storage package where it is installed
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const DB_PATH = path.resolve(__dirname, '../data/links.db');

const db = new Database(DB_PATH);

const entries = db.prepare(`
  SELECT id, pot_id, asset_id
  FROM entries
  WHERE type = 'doc'
    AND asset_id IS NOT NULL
    AND (content_text IS NULL OR content_text = '')
`).all();

if (entries.length === 0) {
  console.log('No entries need reprocessing — all doc assets already have extracted text.');
  db.close();
  process.exit(0);
}

console.log(`Found ${entries.length} doc entry/entries without extracted text. Re-enqueueing...`);

const insert = db.prepare(`
  INSERT INTO processing_jobs
    (id, job_type, status, pot_id, entry_id, priority, attempts, run_after, created_at, updated_at)
  VALUES
    (?, 'extract_text', 'queued', ?, ?, 60, 0, ?, ?, ?)
`);

const now = Date.now();
for (const entry of entries) {
  insert.run(randomUUID(), entry.pot_id, entry.id, now, now, now);
  console.log(`  Enqueued extract_text for entry ${entry.id}`);
}

console.log('✓ Done. The worker will process these on the next idle cycle.');
db.close();
