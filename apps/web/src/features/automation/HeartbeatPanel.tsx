/**
 * HeartbeatPanel
 *
 * Shows the latest heartbeat snapshot: headline, summary, open loops,
 * risks, recommended actions. Includes Run Now and history view.
 */

import { useState } from 'react';
import { useLatestHeartbeat, useHeartbeatHistory, useRunHeartbeat, useRenderHeartbeat } from './useAutomation';

interface Props {
  potId: string;
}

function formatAge(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: '#fc8181',
    medium: '#c9a227',
    low: '#68d391',
    critical: '#fc4c4c',
  };
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 6px',
      borderRadius: 4,
      background: colors[priority] ?? '#555',
      color: '#1a1a1a',
      fontWeight: 600,
      textTransform: 'uppercase',
    }}>
      {priority}
    </span>
  );
}

type View = 'latest' | 'history' | 'document';

export function HeartbeatPanel({ potId }: Props) {
  const [view, setView] = useState<View>('latest');
  const [expandedLoops, setExpandedLoops] = useState(false);
  const [expandedRisks, setExpandedRisks] = useState(false);
  const [expandedActions, setExpandedActions] = useState(false);

  const { data: latest, isLoading } = useLatestHeartbeat(potId);
  const { data: history } = useHeartbeatHistory(potId, 20);
  const runMut = useRunHeartbeat(potId);
  const renderMut = useRenderHeartbeat(potId);

  const snapshot = latest?.snapshot ?? null;
  const document = latest?.document ?? null;

  if (isLoading) {
    return <div style={{ color: 'var(--text-muted)', padding: 16 }}>Loading heartbeat…</div>;
  }

  return (
    <div className="agent-settings-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="agent-settings-panel__heading" style={{ marginBottom: 0 }}>Heartbeat</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['latest', 'document', 'history'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                fontSize: 12,
                background: view === v ? 'var(--gold)' : 'var(--bg-secondary)',
                color: view === v ? '#1a1a1a' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              {v === 'latest' ? 'Status' : v === 'document' ? 'Report' : 'History'}
            </button>
          ))}
        </div>
      </div>

      {/* Run Now controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className="agent-settings-panel__run-btn"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          style={{ fontSize: 12 }}
        >
          {runMut.isPending ? 'Generating…' : 'Run Heartbeat Now'}
        </button>
        {snapshot && (
          <button
            className="agent-settings-panel__history-link"
            onClick={() => renderMut.mutate()}
            disabled={renderMut.isPending}
          >
            {renderMut.isPending ? 'Rendering…' : 'Re-render Report'}
          </button>
        )}
      </div>

      {/* Latest status view */}
      {view === 'latest' && (
        <>
          {!snapshot ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>
              No heartbeat generated yet. Run one now to get a project status summary.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Headline */}
              {snapshot.snapshot?.headline && (
                <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6, borderLeft: '3px solid var(--gold)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {snapshot.snapshot.headline}
                  </div>
                  {snapshot.snapshot?.summary && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {snapshot.snapshot.summary}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Generated {formatAge(snapshot.created_at)} · {snapshot.model_id}
                    {snapshot.snapshot?.confidence !== undefined && ` · ${Math.round(snapshot.snapshot.confidence * 100)}% confidence`}
                  </div>
                </div>
              )}

              {/* What changed */}
              {snapshot.snapshot?.what_changed && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                    What Changed
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {snapshot.snapshot.what_changed}
                  </div>
                </div>
              )}

              {/* Open Loops */}
              {snapshot.snapshot?.open_loops && snapshot.snapshot.open_loops.length > 0 && (
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setExpandedLoops(!expandedLoops)}
                  >
                    <span style={{ color: 'var(--gold)' }}>{expandedLoops ? '▾' : '▸'}</span>
                    Open Loops ({snapshot.snapshot.open_loops.length})
                  </div>
                  {expandedLoops && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {snapshot.snapshot.open_loops.map((loop: any, i: number) => (
                        <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{loop.title}</span>
                            {loop.priority && <PriorityBadge priority={loop.priority} />}
                          </div>
                          {loop.description && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{loop.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Risks */}
              {snapshot.snapshot?.risks && snapshot.snapshot.risks.length > 0 && (
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setExpandedRisks(!expandedRisks)}
                  >
                    <span style={{ color: '#fc8181' }}>{expandedRisks ? '▾' : '▸'}</span>
                    Risks ({snapshot.snapshot.risks.length})
                  </div>
                  {expandedRisks && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {snapshot.snapshot.risks.map((risk: any, i: number) => (
                        <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{risk.title}</span>
                            {risk.severity && <PriorityBadge priority={risk.severity} />}
                          </div>
                          {risk.description && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{risk.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Recommended Actions */}
              {snapshot.snapshot?.recommended_actions && snapshot.snapshot.recommended_actions.length > 0 && (
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setExpandedActions(!expandedActions)}
                  >
                    <span style={{ color: '#68d391' }}>{expandedActions ? '▾' : '▸'}</span>
                    Recommended Actions ({snapshot.snapshot.recommended_actions.length})
                  </div>
                  {expandedActions && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {snapshot.snapshot.recommended_actions.map((action: any, i: number) => (
                        <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{action.action}</span>
                            {action.urgency && (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{action.urgency}</span>
                            )}
                          </div>
                          {action.rationale && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{action.rationale}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Document / Report view */}
      {view === 'document' && (
        <div>
          {!document ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No report generated yet.</div>
          ) : (
            <pre style={{
              fontFamily: 'inherit',
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              padding: 12,
              borderRadius: 6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 500,
              overflowY: 'auto',
            }}>
              {document.content_text}
            </pre>
          )}
        </div>
      )}

      {/* History view */}
      {view === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!history?.snapshots?.length ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No heartbeat history yet.</div>
          ) : (
            history.snapshots.map((snap) => (
              <div key={snap.id} style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {(snap.snapshot as any)?.headline ?? 'Heartbeat'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {snap.period_key} · {formatAge(snap.created_at)} · {snap.model_id}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
