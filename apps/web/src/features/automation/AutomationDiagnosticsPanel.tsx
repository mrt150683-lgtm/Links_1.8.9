/**
 * AutomationDiagnosticsPanel
 *
 * Shows recent task runs, failures, and diagnostics for a pot's automation.
 */

import { useAutomationRuns } from './useAutomation';

interface Props {
  potId: string;
}

function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt || !finishedAt) return '—';
  const ms = finishedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    success: { bg: '#1c4532', text: '#68d391' },
    failed: { bg: '#4a1515', text: '#fc8181' },
    running: { bg: '#1a365d', text: '#63b3ed' },
    skipped: { bg: '#2d3748', text: '#a0aec0' },
  };
  const style = map[status] ?? map.skipped;
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 6px',
      borderRadius: 4,
      background: style.bg,
      color: style.text,
      fontWeight: 600,
      textTransform: 'uppercase',
    }}>
      {status}
    </span>
  );
}

export function AutomationDiagnosticsPanel({ potId }: Props) {
  const { data, isLoading } = useAutomationRuns(potId, 50);
  const runs = data?.runs ?? [];

  const failures = runs.filter((r) => r.status === 'failed');
  const totalTokensIn = runs.reduce((sum, r) => sum + (r.tokens_in ?? 0), 0);
  const totalTokensOut = runs.reduce((sum, r) => sum + (r.tokens_out ?? 0), 0);

  return (
    <div className="agent-settings-panel">
      <div className="agent-settings-panel__heading">Diagnostics</div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Runs', value: runs.length },
          { label: 'Failures', value: failures.length, warn: failures.length > 0 },
          { label: 'Tokens In', value: totalTokensIn.toLocaleString() },
          { label: 'Tokens Out', value: totalTokensOut.toLocaleString() },
        ].map((stat) => (
          <div key={stat.label} style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, minWidth: 100 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: (stat as any).warn ? '#fc8181' : 'var(--text-primary)' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent failures */}
      {failures.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fc8181', marginBottom: 8 }}>
            Recent Failures ({failures.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {failures.slice(0, 5).map((run) => (
              <div key={run.id} style={{ padding: '8px 10px', background: '#2a1515', borderRadius: 6, borderLeft: '3px solid #fc8181' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {formatTime(run.started_at)} · {run.model_id ?? '—'}
                </div>
                {run.error_text && (
                  <div style={{ fontSize: 12, color: '#fc8181', fontFamily: 'monospace' }}>
                    {run.error_text.slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run history table */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Recent Runs ({runs.length})
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No task runs yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map((run) => (
            <div key={run.id} style={{
              padding: '8px 10px',
              background: 'var(--bg-secondary)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}>
              <StatusBadge status={run.status} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>
                {formatTime(run.started_at)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {formatDuration(run.started_at, run.finished_at)}
              </span>
              {run.model_id && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{run.model_id}</span>
              )}
              {(run.tokens_in > 0 || run.tokens_out > 0) && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {run.tokens_in}↑ {run.tokens_out}↓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
