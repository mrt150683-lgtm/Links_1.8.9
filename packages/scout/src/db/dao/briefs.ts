import { randomUUID } from 'crypto';
import type { Db } from '../index.js';

export type BriefStatus =
  | 'draft'
  | 'shortlisted'
  | 'approved'
  | 'rejected'
  | 'rejected_by_threshold';

export interface BriefRow {
  brief_id: string;
  run_id: string;
  score: number;
  repo_ids_json: string;
  brief_json: string;
  brief_md: string;
  outreach_md: string;
  status: BriefStatus;
  created_at: string;
}

export class BriefsDao {
  constructor(private readonly db: Db) {}

  insert(opts: {
    run_id: string;
    score: number;
    repo_ids: string[];
    brief: unknown;
    brief_md: string;
    outreach_md: string;
    status: BriefStatus;
  }): BriefRow {
    const brief_id = randomUUID();
    const created_at = new Date().toISOString();

    const row: BriefRow = {
      brief_id,
      run_id: opts.run_id,
      score: opts.score,
      repo_ids_json: JSON.stringify(opts.repo_ids.sort()),
      brief_json: JSON.stringify(opts.brief),
      brief_md: opts.brief_md,
      outreach_md: opts.outreach_md,
      status: opts.status,
      created_at,
    };

    this.db
      .prepare(
        `INSERT INTO briefs
           (brief_id, run_id, score, repo_ids_json, brief_json, brief_md, outreach_md, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        row.brief_id,
        row.run_id,
        row.score,
        row.repo_ids_json,
        row.brief_json,
        row.brief_md,
        row.outreach_md,
        row.status,
        row.created_at
      );

    return row;
  }

  listByRunId(run_id: string): BriefRow[] {
    return this.db
      .prepare('SELECT * FROM briefs WHERE run_id = ? ORDER BY score DESC')
      .all(run_id) as BriefRow[];
  }

  updateStatus(brief_id: string, status: BriefStatus): void {
    this.db.prepare('UPDATE briefs SET status = ? WHERE brief_id = ?').run(status, brief_id);
  }
}
