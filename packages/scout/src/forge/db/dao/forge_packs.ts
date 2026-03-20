import type { Db } from '../../../db/index.js';

export interface ForgePack {
  pack_id: string;
  run_id: string;
  score: number;
  repo_ids_json: string;
  reasons_json: string;
  merge_plan_md?: string | null;
  status: 'draft' | 'final';
  created_at: string;
}

export class ForgePacksDao {
  constructor(private db: Db) {}

  create(pack: ForgePack): void {
    this.db
      .prepare(
        'INSERT INTO forge_packs (pack_id, run_id, score, repo_ids_json, reasons_json, merge_plan_md, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        pack.pack_id,
        pack.run_id,
        pack.score,
        pack.repo_ids_json,
        pack.reasons_json,
        pack.merge_plan_md ?? null,
        pack.status,
        pack.created_at
      );
  }

  getByRunId(run_id: string): ForgePack[] {
    return this.db
      .prepare('SELECT * FROM forge_packs WHERE run_id = ? ORDER BY score DESC')
      .all(run_id) as ForgePack[];
  }
}
