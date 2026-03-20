#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../data/links.db'));

// 1. All doc entries
const docs = db.prepare(`
  SELECT e.id, e.type, e.source_title, a.mime_type, a.original_filename,
         CASE WHEN e.content_text IS NULL OR e.content_text = '' THEN 'NO TEXT' ELSE 'HAS TEXT' END as text_status
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.type = 'doc'
  ORDER BY e.captured_at DESC
`).all();
console.log('=== DOC ENTRIES ===');
docs.forEach(r => console.log(r.text_status, '|', r.mime_type, '|', (r.original_filename || '').slice(0,50), '|', r.id.slice(0,8)));

// 2. extract_text jobs
const jobs = db.prepare(`
  SELECT j.id, j.entry_id, j.status, j.created_at
  FROM processing_jobs j
  WHERE j.job_type = 'extract_text'
  ORDER BY j.created_at DESC
  LIMIT 20
`).all();
console.log('\n=== EXTRACT_TEXT JOBS ===');
jobs.forEach(j => console.log(j.status.padEnd(8), '|', j.entry_id.slice(0,8), '|', new Date(j.created_at).toLocaleTimeString()));

// 3. Count queued jobs total
const queued = db.prepare(`SELECT COUNT(*) as c FROM processing_jobs WHERE status = 'queued'`).get();
console.log('\n=== QUEUED JOBS TOTAL:', queued.c, '===');

db.close();
