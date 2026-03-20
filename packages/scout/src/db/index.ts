import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export type Db = Database.Database;

export interface OpenDbOptions {
  path: string;
  readonly?: boolean;
}

export function openDb({ path: dbPath, readonly = false }: OpenDbOptions): Db {
  const dir = path.dirname(dbPath);
  if (!readonly) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { readonly });

  if (!readonly) {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  return db;
}

export function closeDb(db: Db): void {
  db.close();
}

/**
 * Run a function inside a transaction. Rolls back on error.
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  const txn = db.transaction(fn);
  return txn();
}
