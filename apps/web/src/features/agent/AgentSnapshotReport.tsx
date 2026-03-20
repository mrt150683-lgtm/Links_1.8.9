/**
 * AgentSnapshotReport
 *
 * Snapshot timeline with diff reports for a pot.
 */

import { useAgentSnapshots } from './useAgent';
import type { AgentSnapshot } from './useAgent';
import './agent.css';

interface Props {
  potId: string;
}

export function AgentSnapshotReport({ potId }: Props) {
  const { data, isLoading } = useAgentSnapshots(potId);
  const snapshots = data?.snapshots ?? [];

  if (isLoading) return <div className="agent-loading">Loading snapshots…</div>;
  if (snapshots.length === 0) {
    return (
      <div className="agent-page__empty">
        No snapshots yet. Snapshots are created automatically after each heartbeat run (once every 24 hours).
      </div>
    );
  }

  return (
    <div className="agent-snapshot-timeline">
      {snapshots.map((snap) => (
        <SnapshotCard key={snap.id} snapshot={snap} />
      ))}
    </div>
  );
}

function SnapshotCard({ snapshot }: { snapshot: AgentSnapshot }) {
  const manifest = snapshot.manifest as any;
  const report = snapshot.report?.payload as any;
  const reportData = report?.report ?? null;

  return (
    <div
      style={{
        padding: '12px 16px',
        marginBottom: 12,
        borderRadius: 10,
        border: '1px solid var(--border, #3a3a3a)',
        background: 'var(--card-bg, #1a1a1a)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold, #c9a227)' }}>
          Snapshot
        </span>
        <span style={{ fontSize: 11, color: '#888' }}>
          {new Date(snapshot.created_at).toLocaleString()}
        </span>
      </div>

      {manifest && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#aaa', marginBottom: 8, flexWrap: 'wrap' }}>
          <span>Entries: {manifest.entry_count ?? '?'}</span>
          <span>Entities: {manifest.entity_count ?? '?'}</span>
          <span>Links: {manifest.link_count ?? '?'}</span>
          <span>Artifacts: {manifest.artifact_count ?? '?'}</span>
        </div>
      )}

      {manifest?.diff && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Changes: </span>
          {formatDiff(manifest.diff)}
        </div>
      )}

      {reportData?.headline && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', marginBottom: 6 }}>
          {reportData.headline}
        </div>
      )}

      {reportData?.research_velocity && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <VelocityBadge velocity={reportData.research_velocity} />
          {reportData.sentiment && <SentimentBadge sentiment={reportData.sentiment} />}
        </div>
      )}

      {reportData?.top_themes && reportData.top_themes.length > 0 && (
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>Themes: </span>
          {reportData.top_themes.join(', ')}
        </div>
      )}

      {reportData?.gaps_detected && reportData.gaps_detected.length > 0 && (
        <div style={{ fontSize: 11, color: '#c44', marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>Gaps: </span>
          {reportData.gaps_detected.join('; ')}
        </div>
      )}

      {reportData?.recommendations && reportData.recommendations.length > 0 && (
        <div style={{ fontSize: 11, color: '#8c8', marginTop: 4 }}>
          <span style={{ fontWeight: 600 }}>Recommendations: </span>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {reportData.recommendations.map((r: string, i: number) => (
              <li key={i} style={{ marginBottom: 2 }}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDiff(diff: any): string {
  const parts: string[] = [];
  if (diff.delta_entries) parts.push(`${diff.delta_entries > 0 ? '+' : ''}${diff.delta_entries} entries`);
  if (diff.delta_links) parts.push(`${diff.delta_links > 0 ? '+' : ''}${diff.delta_links} links`);
  if (diff.delta_entities) parts.push(`${diff.delta_entities > 0 ? '+' : ''}${diff.delta_entities} entities`);
  if (diff.new_tags?.length) parts.push(`+${diff.new_tags.length} new tags`);
  if (diff.lost_tags?.length) parts.push(`-${diff.lost_tags.length} lost tags`);
  if (diff.days_since_last) parts.push(`${diff.days_since_last}d since last`);
  return parts.join(' | ') || 'No significant changes';
}

function VelocityBadge({ velocity }: { velocity: string }) {
  const colors: Record<string, string> = {
    growing: '#4c8',
    stable: '#888',
    stagnant: '#c44',
    converging: '#48c',
  };
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 8px',
        borderRadius: 8,
        background: `${colors[velocity] ?? '#888'}22`,
        color: colors[velocity] ?? '#888',
        border: `1px solid ${colors[velocity] ?? '#888'}`,
      }}
    >
      {velocity}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    positive: '#4c8',
    neutral: '#888',
    needs_attention: '#c44',
  };
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 8px',
        borderRadius: 8,
        background: `${colors[sentiment] ?? '#888'}22`,
        color: colors[sentiment] ?? '#888',
        border: `1px solid ${colors[sentiment] ?? '#888'}`,
      }}
    >
      {sentiment.replace(/_/g, ' ')}
    </span>
  );
}
