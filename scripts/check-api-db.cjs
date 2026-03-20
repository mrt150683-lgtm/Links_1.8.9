#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../apps/api/data/links.db'));

const pots = db.prepare(`SELECT id, name FROM pots`).all();
console.log('=== POTS ===');
pots.forEach(p => console.log(p.name, '|', p.id));

const mdEntries = db.prepare(`
  SELECT e.id, e.type, e.pot_id, e.source_title,
         CASE WHEN e.content_text IS NULL OR e.content_text = '' THEN 'NO TEXT' ELSE 'HAS TEXT' END as text_status,
         a.mime_type, a.original_filename
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.source_title LIKE '%.md%'
     OR a.original_filename LIKE '%.md'
     OR e.source_title LIKE '%Grok%'
     OR e.source_title LIKE '%Hinge%'
     OR e.source_title LIKE '%Wiring%'
     OR e.source_title LIKE '%xAI%'
`).all();
console.log('\n=== MD/GROK ENTRIES ===');
mdEntries.forEach(r => console.log(r.type, '|', r.text_status, '|', r.mime_type, '|', r.original_filename, '|', r.source_title, '|', r.id.slice(0,8)));

const totals = db.prepare(`
  SELECT p.name, e.type, COUNT(*) as cnt
  FROM entries e
  JOIN pots p ON p.id = e.pot_id
  GROUP BY p.name, e.type
  ORDER BY p.name, e.type
`).all();
console.log('\n=== ENTRY COUNTS ===');
totals.forEach(r => console.log(r.name, '|', r.type, '|', r.cnt));

// Check doc entries without text
const noText = db.prepare(`
  SELECT e.id, e.source_title, a.mime_type, a.original_filename
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.type = 'doc'
    AND (e.content_text IS NULL OR e.content_text = '')
`).all();
console.log('\n=== DOC ENTRIES WITHOUT TEXT ===');
noText.forEach(r => console.log(r.mime_type, '|', r.original_filename, '|', r.source_title, '|', r.id.slice(0,8)));

db.close();
