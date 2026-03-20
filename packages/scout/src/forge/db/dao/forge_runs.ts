import type { Db } from '../../../db/index.js';

export interface ForgeRun {
  run_id: string;
  mode: 'repo' | 'idea';
  seed_text?: string | null;
  seed_repo_full_name?: string | null;
  created_at: string;
}

export class ForgeRunsDao {
  constructor(private db: Db) {}

  create(run: ForgeRun): void {
    this.db
      .prepare(
        'INSERT INTO forge_runs (run_id, mode, seed_text, seed_repo_full_name, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        run.run_id,
        run.mode,
        run.seed_text ?? null,
        run.seed_repo_full_name ?? null,
        run.created_at
      );
  }

  getById(run_id: string): ForgeRun | undefined {
    return this.db
      .prepare('SELECT * FROM forge_runs WHERE run_id = ?')
      .get(run_id) as ForgeRun | undefined;
  }
}
