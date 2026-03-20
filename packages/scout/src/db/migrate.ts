import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Db } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _migrationsDirOverride: string | null = null;

/** Override the migrations directory (for bundled/Electron builds). */
export function setMigrationsDir(dir: string): void {
  _migrationsDirOverride = dir;
}

function resolveMigrationsDir(): string {
  return _migrationsDirOverride ?? path.join(__dirname, 'migrations');
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

function getMigrationFiles(): string[] {
  if (!fs.existsSync(resolveMigrationsDir())) return [];
  return fs
    .readdirSync(resolveMigrationsDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(db: Db): MigrateResult {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const files = getMigrationFiles();

  const result: MigrateResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }

    const sql = fs.readFileSync(path.join(resolveMigrationsDir(), file), 'utf-8');

    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      );
    });
    applyMigration();

    result.applied.push(file);
  }

  return result;
}

export function getSchemaVersion(db: Db): string | null {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function getLatestMigration(db: Db): string | null {
  try {
    ensureMigrationsTable(db);
    const row = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1')
      .get() as AppliedMigration | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}
