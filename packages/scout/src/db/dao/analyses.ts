import { createHash, randomUUID } from 'crypto';
import type { Db } from '../index.js';

export interface AnalysisRow {
  analysis_id: string;
  repo_id: string;
  run_id: string;
  model: string;
  prompt_id: string;
  prompt_version: string;
  input_snapshot_json: string;
  output_json: string;
  llm_scores_json: string;
  final_score: number;
  reasons_json: string;
  created_at: string;
}

export interface KeywordRow {
  keyword_id: string;
  run_id: string;
  repo_id: string | null;
  keyword: string;
  kind: string;
  weight: number;
}

export class AnalysesDao {
  constructor(private readonly db: Db) {}

  insert(opts: {
    repo_id: string;
    run_id: string;
    model: string;
    prompt_id: string;
    prompt_version: string;
    input_snapshot: Record<string, unknown>;
    output: unknown;
    llm_scores: Record<string, number>;
    final_score: number;
    reasons: Record<string, string[]>;
  }): AnalysisRow {
    const analysis_id = randomUUID();
    const created_at = new Date().toISOString();

    const row: AnalysisRow = {
      analysis_id,
      repo_id: opts.repo_id,
      run_id: opts.run_id,
      model: opts.model,
      prompt_id: opts.prompt_id,
      prompt_version: opts.prompt_version,
      input_snapshot_json: JSON.stringify(opts.input_snapshot),
      output_json: JSON.stringify(opts.output),
      llm_scores_json: JSON.stringify(opts.llm_scores),
      final_score: opts.final_score,
      reasons_json: JSON.stringify(opts.reasons),
      created_at,
    };

    this.db
      .prepare(
        `INSERT INTO analyses
           (analysis_id, repo_id, run_id, model, prompt_id, prompt_version,
            input_snapshot_json, output_json, llm_scores_json, final_score, reasons_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        row.analysis_id,
        row.repo_id,
        row.run_id,
        row.model,
        row.prompt_id,
        row.prompt_version,
        row.input_snapshot_json,
        row.output_json,
        row.llm_scores_json,
        row.final_score,
        row.reasons_json,
        row.created_at
      );

    return row;
  }

  getByRepoAndRun(repo_id: string, run_id: string): AnalysisRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM analyses WHERE repo_id = ? AND run_id = ?')
        .get(repo_id, run_id) as AnalysisRow | undefined) ?? null
    );
  }

  listByRunId(run_id: string): AnalysisRow[] {
    return this.db
      .prepare('SELECT * FROM analyses WHERE run_id = ? ORDER BY created_at')
      .all(run_id) as AnalysisRow[];
  }
}

export class KeywordsDao {
  constructor(private readonly db: Db) {}

  insert(opts: {
    run_id: string;
    repo_id: string | null;
    keyword: string;
    kind: string;
    weight?: number;
  }): KeywordRow {
    const keyword_id = createHash('sha256')
      .update(`${opts.run_id}:${opts.repo_id ?? ''}:${opts.keyword}:${opts.kind}`)
      .digest('hex')
      .slice(0, 16);

    const row: KeywordRow = {
      keyword_id,
      run_id: opts.run_id,
      repo_id: opts.repo_id,
      keyword: opts.keyword,
      kind: opts.kind,
      weight: opts.weight ?? 1.0,
    };

    this.db
      .prepare(
        'INSERT OR IGNORE INTO keywords (keyword_id, run_id, repo_id, keyword, kind, weight) VALUES (?,?,?,?,?,?)'
      )
      .run(row.keyword_id, row.run_id, row.repo_id, row.keyword, row.kind, row.weight);

    return row;
  }

  listByRunId(run_id: string): KeywordRow[] {
    return this.db
      .prepare('SELECT * FROM keywords WHERE run_id = ? ORDER BY weight DESC')
      .all(run_id) as KeywordRow[];
  }
}
