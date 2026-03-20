import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Database as DatabaseType } from './types.js';

export interface DatabaseConfig {
  filename: string;
  readonly?: boolean;
}

let dbInstance: Kysely<DatabaseType> | null = null;
let sqliteInstance: Database.Database | null = null;

/**
 * Initialize database connection with required pragmas
 */
export function initDatabase(config: DatabaseConfig): Kysely<DatabaseType> {
  if (dbInstance) {
    return dbInstance;
  }

  // Create better-sqlite3 instance
  const sqlite = new Database(config.filename, {
    readonly: config.readonly ?? false,
    fileMustExist: false,
  });

  // Set critical pragmas
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  sqliteInstance = sqlite;

  // Create Kysely instance
  const dialect = new SqliteDialect({
    database: sqlite,
  });

  dbInstance = new Kysely<DatabaseType>({
    dialect,
  });

  return dbInstance;
}

/**
 * Get current database instance (must call initDatabase first)
 */
export function getDatabase(): Kysely<DatabaseType> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Get raw SQLite instance for migrations
 */
export function getSqliteInstance(): Database.Database {
  if (!sqliteInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return sqliteInstance;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
  }
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return dbInstance !== null;
}
