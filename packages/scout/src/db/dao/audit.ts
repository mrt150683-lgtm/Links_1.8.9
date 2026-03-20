import type { Db } from '../index.js';
import { redactSecrets } from '../../config/redact.js';

export type AuditLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditRow {
  id?: number;
  ts: string;
  level: AuditLevel;
  run_id: string | null;
  scope: string | null;
  event: string;
  message: string;
  data_json: string | null;
}

export interface WriteAuditOptions {
  level?: AuditLevel;
  run_id?: string | null;
  scope?: string | null;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export class AuditDao {
  constructor(private readonly db: Db) {}

  write(opts: WriteAuditOptions): void {
    const row: AuditRow = {
      ts: new Date().toISOString(),
      level: opts.level ?? 'info',
      run_id: opts.run_id ?? null,
      scope: opts.scope ?? null,
      event: opts.event,
      message: opts.message,
      data_json: opts.data ? JSON.stringify(redactSecrets(opts.data)) : null,
    };

    this.db
      .prepare(
        'INSERT INTO audit_log (ts, level, run_id, scope, event, message, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(row.ts, row.level, row.run_id, row.scope, row.event, row.message, row.data_json);
  }

  list(opts: { run_id?: string; event?: string; limit?: number } = {}): AuditRow[] {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (opts.run_id) {
      sql += ' AND run_id = ?';
      params.push(opts.run_id);
    }
    if (opts.event) {
      sql += ' AND event = ?';
      params.push(opts.event);
    }

    sql += ' ORDER BY ts DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    return this.db.prepare(sql).all(...params) as AuditRow[];
  }
}
