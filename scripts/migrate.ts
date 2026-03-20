#!/usr/bin/env node
import { getConfig } from '../packages/config/src/index.js';
import { initDatabase, runMigrations, closeDatabase } from '../packages/storage/src/index.js';

async function main() {
  try {
    const config = getConfig();

    console.log('Initializing database...');
    initDatabase({ filename: config.DATABASE_PATH });

    console.log('Running migrations...');
    runMigrations();

    console.log('✓ Migrations complete');

    closeDatabase();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
