import { createHash } from 'crypto';
import type { Db } from '../index.js';

export interface RunRow {
  run_id: string;
  created_at: string;
  args_json: string;
  git_sha: string | null;
  config_hash: string;
}

export interface CreateRunOptions {
  run_id: string;
  args: Record<string, unknown>;
  git_sha?: string | null;
  config: Record<string, unknown>;
}

export function computeConfigHash(config: Record<string, unknown>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b)))
  );
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

export class RunsDao {
  constructor(private readonly db: Db) {}

  create(opts: CreateRunOptions): RunRow {
    const row: RunRow = {
      run_id: opts.run_id,
      created_at: new Date().toISOString(),
      args_json: JSON.stringify(opts.args),
      git_sha: opts.git_sha ?? null,
      config_hash: computeConfigHash(opts.config),
    };

    this.db
      .prepare(
        'INSERT INTO runs (run_id, created_at, args_json, git_sha, config_hash) VALUES (?, ?, ?, ?, ?)'
      )
      .run(row.run_id, row.created_at, row.args_json, row.git_sha, row.config_hash);

    return row;
  }

  get(run_id: string): RunRow | null {
    return (
      (this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(run_id) as RunRow | undefined) ??
      null
    );
  }
}
