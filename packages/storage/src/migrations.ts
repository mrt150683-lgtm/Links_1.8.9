import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSqliteInstance } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Migration {
  id: number;
  name: string;
  filename: string;
  sql: string;
}

/**
 * Get all migration files from migrations/ directory
 */
function getMigrationFiles(): Migration[] {
  const migrationsDir = join(__dirname, '../migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const id = parseInt(match[1], 10);
    const name = match[2];
    const sql = readFileSync(join(migrationsDir, filename), 'utf-8');

    return { id, name, filename, sql };
  });
}

/**
 * Ensure migrations tracking table exists
 */
function ensureMigrationsTable(): void {
  const db = getSqliteInstance();
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(): Set<number> {
  const db = getSqliteInstance();
  ensureMigrationsTable();

  const rows = db.prepare('SELECT id FROM migrations ORDER BY id').all() as Array<{ id: number }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * Apply a single migration
 */
function applyMigration(migration: Migration): void {
  const db = getSqliteInstance();

  console.log(`Applying migration ${migration.id}: ${migration.name}`);

  // Execute migration SQL
  db.exec(migration.sql);

  // Record migration as applied
  db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
    migration.id,
    migration.name,
    Date.now()
  );

  console.log(`✓ Migration ${migration.id} applied successfully`);
}

/**
 * Check if a migration contains PRAGMA statements that must run outside transactions.
 * SQLite PRAGMAs like foreign_keys cannot be changed inside a transaction.
 */
function requiresOutsideTransaction(sql: string): boolean {
  return /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql);
}

/**
 * Attempt to acquire the global migration mutex
 */
function acquireMigrationLock(): boolean {
  try {
    const db = getSqliteInstance();
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_locks (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        is_locked INTEGER NOT NULL DEFAULT 0,
        locked_at INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      INSERT OR IGNORE INTO migration_locks (id, is_locked, locked_at) VALUES (1, 0, 0);
    `);

    const now = Date.now();
    const timeout = now - 60000; // 1-minute expiration to prevent stale locks
    const result = db.prepare(`
      UPDATE migration_locks 
      SET is_locked = 1, locked_at = ? 
      WHERE id = 1 AND (is_locked = 0 OR locked_at < ?)
    `).run(now, timeout);

    return result.changes > 0;
  } catch (err: any) {
    if (err.message && err.message.includes('database is locked')) {
      return false;
    }
    throw err;
  }
}

/**
 * Release the global migration mutex
 */
function releaseMigrationLock(): void {
  try {
    const db = getSqliteInstance();
    db.prepare('UPDATE migration_locks SET is_locked = 0, locked_at = 0 WHERE id = 1').run();
  } catch (err: any) {
    if (err.message && !err.message.includes('database is locked')) {
      throw err;
    }
  }
}

/**
 * Run all pending migrations
 */
export function runMigrations(): void {
  let lockAcquired = false;

  // Try to acquire lock for up to 30 seconds
  for (let i = 0; i < 60; i++) {
    if (acquireMigrationLock()) {
      lockAcquired = true;
      break;
    }
    const waitTill = Date.now() + 500;
    while (Date.now() < waitTill) { /* busy wait fallback for sync operations */ }
  }

  if (!lockAcquired) {
    throw new Error('Failed to acquire database migration lock after 30 seconds.');
  }

  try {
    const db = getSqliteInstance();
    const allMigrations = getMigrationFiles();
    const appliedMigrations = getAppliedMigrations();

    const pendingMigrations = allMigrations.filter((m) => !appliedMigrations.has(m.id));

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s)`);

    for (const migration of pendingMigrations) {
      if (requiresOutsideTransaction(migration.sql)) {
        // Migrations that toggle PRAGMAs must run outside a transaction
        applyMigration(migration);
      } else {
        const transaction = db.transaction(() => {
          applyMigration(migration);
        });
        transaction();
      }
    }

    console.log('All migrations applied successfully');
  } finally {
    releaseMigrationLock();
  }
}

/**
 * Get migration status
 */
export function getMigrationStatus(): {
  applied: number[];
  pending: number[];
} {
  const allMigrations = getMigrationFiles();
  const appliedMigrations = getAppliedMigrations();

  return {
    applied: Array.from(appliedMigrations).sort(),
    pending: allMigrations.filter((m) => !appliedMigrations.has(m.id)).map((m) => m.id),
  };
}
