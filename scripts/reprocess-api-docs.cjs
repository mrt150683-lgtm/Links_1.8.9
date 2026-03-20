#!/usr/bin/env node
'use strict';
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
// Use the API's database (the one the API server actually reads)
const db = new Database(path.resolve(__dirname, '../apps/api/data/links.db'));

const entries = db.prepare(`
  SELECT e.id, e.pot_id, e.source_title, a.mime_type, a.original_filename
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.type = 'doc'
    AND e.asset_id IS NOT NULL
    AND (e.content_text IS NULL OR e.content_text = '')
`).all();

if (entries.length === 0) {
  console.log('No entries need reprocessing.');
  db.close();
  process.exit(0);
}

console.log(`Found ${entries.length} doc entries without text. Re-enqueueing extract_text jobs...`);

const insert = db.prepare(`
  INSERT INTO processing_jobs
    (id, job_type, status, pot_id, entry_id, priority, attempts, run_after, created_at, updated_at)
  VALUES
    (?, 'extract_text', 'queued', ?, ?, 60, 0, ?, ?, ?)
`);

const now = Date.now();
for (const entry of entries) {
  insert.run(randomUUID(), entry.pot_id, entry.id, now, now, now);
  console.log(`  ${entry.original_filename || entry.source_title} (${entry.mime_type})`);
}

console.log(`\n✓ Enqueued ${entries.length} jobs. Restart the worker to process them.`);
db.close();
