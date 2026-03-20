#!/usr/bin/env node
'use strict';
const path = require('path');
const Database = require(path.resolve(__dirname, '../packages/storage/node_modules/better-sqlite3'));
const db = new Database(path.resolve(__dirname, '../apps/api/data/links.db'));

// Check intelligence runs
const runs = db.prepare(`SELECT * FROM intelligence_runs ORDER BY created_at DESC LIMIT 10`).all();
console.log('=== INTELLIGENCE RUNS ===');
if (runs.length === 0) console.log('  (none)');
runs.forEach(r => console.log(r.status, '|', r.mode, '|', r.pot_id.slice(0,8), '|', new Date(r.created_at).toLocaleString()));

// Check intelligence questions
const questions = db.prepare(`SELECT COUNT(*) as c FROM intelligence_questions`).get();
console.log('\n=== TOTAL QUESTIONS:', questions.c, '===');

// Check worker job status
const jobs = db.prepare(`
  SELECT job_type, status, COUNT(*) as cnt
  FROM processing_jobs
  GROUP BY job_type, status
  ORDER BY job_type, status
`).all();
console.log('\n=== JOB STATUS SUMMARY ===');
jobs.forEach(j => console.log(j.job_type.padEnd(30), '|', j.status.padEnd(8), '|', j.cnt));

// Check how many entries now have content_text
const withText = db.prepare(`
  SELECT COUNT(*) as c FROM entries WHERE content_text IS NOT NULL AND content_text != ''
`).get();
const total = db.prepare(`SELECT COUNT(*) as c FROM entries`).get();
console.log('\n=== ENTRIES WITH TEXT:', withText.c, '/', total.c, '===');

db.close();
