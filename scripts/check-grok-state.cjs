#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../apps/api/data/links.db'));

const GROK_POT = 'ba6af904-7db8-4b19-9ea8-e0e931f54a5d';

// Grok entries WITH text
const withText = db.prepare(`
  SELECT e.id, e.source_title, a.mime_type, a.original_filename, LENGTH(e.content_text) as text_len
  FROM entries e LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.pot_id = ? AND e.content_text IS NOT NULL AND e.content_text != ''
`).all(GROK_POT);
console.log('=== GROK ENTRIES WITH TEXT (' + withText.length + ') ===');
withText.forEach(r => console.log(' ', r.mime_type, '|', (r.original_filename || '').slice(0,50), '|', r.text_len, 'chars'));

// Grok entries WITHOUT text
const noText = db.prepare(`
  SELECT COUNT(*) as c FROM entries e
  WHERE e.pot_id = ? AND (e.content_text IS NULL OR e.content_text = '')
`).get(GROK_POT);
console.log('\nGrok entries WITHOUT text:', noText.c);

// Queued/running jobs
const active = db.prepare(`
  SELECT job_type, status, COUNT(*) as c
  FROM processing_jobs WHERE status IN ('queued','running')
  GROUP BY job_type, status
`).all();
console.log('\n=== ACTIVE JOBS ===', active.length === 0 ? 'none' : '');
active.forEach(j => console.log(' ', j.job_type, j.status, j.c));

db.close();
