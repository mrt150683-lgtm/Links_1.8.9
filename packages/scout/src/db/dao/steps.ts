import type { Db } from '../index.js';

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface StepRow {
  step_id: string;
  run_id: string;
  name: string;
  started_at: string;
  finished_at: string | null;
  status: StepStatus | null;
  stats_json: string | null;
}

export class StepsDao {
  constructor(private readonly db: Db) {}

  start(opts: { step_id: string; run_id: string; name: string }): StepRow {
    const row: StepRow = {
      step_id: opts.step_id,
      run_id: opts.run_id,
      name: opts.name,
      started_at: new Date().toISOString(),
      finished_at: null,
      status: null,
      stats_json: null,
    };

    this.db
      .prepare(
        'INSERT INTO run_steps (step_id, run_id, name, started_at, finished_at, status, stats_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        row.step_id,
        row.run_id,
        row.name,
        row.started_at,
        row.finished_at,
        row.status,
        row.stats_json
      );

    return row;
  }

  finish(opts: {
    step_id: string;
    status: StepStatus;
    stats?: Record<string, unknown>;
    started_at: string;
  }): void {
    const finished_at = new Date().toISOString();
    const duration_ms =
      new Date(finished_at).getTime() - new Date(opts.started_at).getTime();
    const stats = { ...(opts.stats ?? {}), duration_ms };

    this.db
      .prepare(
        'UPDATE run_steps SET finished_at = ?, status = ?, stats_json = ? WHERE step_id = ?'
      )
      .run(finished_at, opts.status, JSON.stringify(stats), opts.step_id);
  }

  list(run_id: string): StepRow[] {
    return this.db
      .prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at')
      .all(run_id) as StepRow[];
  }
}
