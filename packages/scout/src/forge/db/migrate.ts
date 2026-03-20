import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Db } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _forgeMigrationsDirOverride: string | null = null;

/**
 * Override both core + forge migration directories (for bundled/Electron builds).
 * Pass the root directory that contains all Scout .sql migration files.
 */
export function setForgeMigrationsDir(dir: string): void {
  _forgeMigrationsDirOverride = dir;
}

// Default paths (work in dev when running from source)
function resolveCoreMigrationsDir(): string {
  return _forgeMigrationsDirOverride ?? path.join(__dirname, '../../../src/db/migrations');
}

function resolveForgeMigrationsDir(): string {
  return _forgeMigrationsDirOverride ?? path.join(__dirname, 'migrations');
}

interface AppliedMigration {
  id: string;
  applied_at: string;
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

function getAppliedMigrations(db: Db): Set<string> {
  const rows = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as AppliedMigration[];
  return new Set(rows.map((r) => r.id));
}

function getMigrationFiles(): { id: string; fullPath: string }[] {
  const files: { id: string; fullPath: string }[] = [];
  
  const coreMigrDir = resolveCoreMigrationsDir();
  if (fs.existsSync(coreMigrDir)) {
    fs.readdirSync(coreMigrDir)
      .filter((f) => f.endsWith('.sql'))
      .forEach(f => files.push({ id: f, fullPath: path.join(coreMigrDir, f) }));
  }

  const forgeMigrDir = resolveForgeMigrationsDir();
  if (fs.existsSync(forgeMigrDir)) {
    fs.readdirSync(forgeMigrDir)
      .filter((f) => f.endsWith('.sql'))
      .forEach(f => files.push({ id: f, fullPath: path.join(forgeMigrDir, f) }));
  }
  
  // Sort by filename (id) to ensure correct order (0001, 0002, ..., 0006)
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export function runForgeMigrations(db: Db): MigrateResult {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const files = getMigrationFiles();

  const result: MigrateResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (applied.has(file.id)) {
      result.skipped.push(file.id);
      continue;
    }

    const sql = fs.readFileSync(file.fullPath, 'utf-8');

    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        file.id,
        new Date().toISOString()
      );
    });
    applyMigration();

    result.applied.push(file.id);
  }

  return result;
}
