#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../data/links.db'));

// All entries with their asset info
const entries = db.prepare(`
  SELECT e.id, e.type, e.source_title, e.content_text,
         a.mime_type, a.original_filename, a.size_bytes
  FROM entries e
  LEFT JOIN assets a ON a.id = e.asset_id
  ORDER BY e.captured_at DESC
  LIMIT 30
`).all();

console.log('=== ALL ENTRIES (latest 30) ===');
entries.forEach(r => {
  const hasText = r.content_text && r.content_text.trim().length > 0;
  const textLen = hasText ? r.content_text.trim().length : 0;
  console.log(
    r.type.padEnd(6), '|',
    (hasText ? 'TEXT:'+textLen : 'NO TEXT').padEnd(12), '|',
    (r.mime_type || 'n/a').padEnd(35), '|',
    (r.original_filename || r.source_title || '').slice(0,50), '|',
    r.id.slice(0,8)
  );
});

// Check for any .md or .txt files in assets
const mdAssets = db.prepare(`
  SELECT a.id, a.mime_type, a.original_filename, a.size_bytes
  FROM assets a
  WHERE a.original_filename LIKE '%.md' OR a.original_filename LIKE '%.txt'
     OR a.mime_type LIKE 'text/%'
`).all();
console.log('\n=== ASSETS WITH .md/.txt OR text/* MIME ===');
mdAssets.forEach(r => console.log(r.mime_type, '|', r.original_filename, '|', r.id.slice(0,8)));

db.close();
