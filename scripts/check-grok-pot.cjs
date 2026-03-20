#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../data/links.db'));

// Find all pots
const pots = db.prepare(`SELECT id, name FROM pots`).all();
console.log('=== POTS ===');
pots.forEach(p => console.log(p.name, '|', p.id));

// Search for entries with .md in source_title or filename
const mdEntries = db.prepare(`
  SELECT e.id, e.type, e.pot_id, e.source_title, e.content_text,
         a.mime_type, a.original_filename
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  WHERE e.source_title LIKE '%.md%'
     OR a.original_filename LIKE '%.md'
     OR e.source_title LIKE '%Grok%'
     OR e.source_title LIKE '%Hinge%'
     OR e.source_title LIKE '%Wiring%'
`).all();
console.log('\n=== ENTRIES MATCHING .md/Grok/Hinge/Wiring ===');
if (mdEntries.length === 0) {
  console.log('  (none found)');
} else {
  mdEntries.forEach(r => {
    const hasText = r.content_text && r.content_text.trim().length > 0;
    console.log(r.type, '|', r.mime_type, '|', r.source_title, '|', r.original_filename, '|', r.id.slice(0,8), '| text:', hasText);
  });
}

// Total entries per pot
const totals = db.prepare(`
  SELECT p.name, e.type, COUNT(*) as cnt
  FROM entries e
  JOIN pots p ON p.id = e.pot_id
  GROUP BY p.name, e.type
  ORDER BY p.name, e.type
`).all();
console.log('\n=== ENTRY COUNTS PER POT ===');
totals.forEach(r => console.log(r.name, '|', r.type, '|', r.cnt));

db.close();
