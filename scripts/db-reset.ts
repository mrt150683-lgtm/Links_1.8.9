#!/usr/bin/env node
import { unlinkSync, existsSync } from 'node:fs';
import { getConfig } from '../packages/config/src/index.js';
import { initDatabase, runMigrations, closeDatabase } from '../packages/storage/src/index.js';

async function main() {
  try {
    const config = getConfig();
    const dbPath = config.DATABASE_PATH;

    console.log('Resetting database...');

    // Close any existing connection
    closeDatabase();

    // Delete database files
    const filesToDelete = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];
    for (const file of filesToDelete) {
      if (existsSync(file)) {
        unlinkSync(file);
        console.log(`Deleted ${file}`);
      }
    }

    console.log('Initializing fresh database...');
    initDatabase({ filename: dbPath });

    console.log('Running migrations...');
    runMigrations();

    console.log('✓ Database reset complete');

    closeDatabase();
  } catch (error) {
    console.error('Database reset failed:', error);
    process.exit(1);
  }
}

main();
