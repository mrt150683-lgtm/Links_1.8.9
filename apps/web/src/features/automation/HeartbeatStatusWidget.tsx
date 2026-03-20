/**
 * HeartbeatStatusWidget
 *
 * Dashboard widget showing heartbeat status for pots that have it enabled.
 * Shown on the main dashboard.
 */

import { useLatestHeartbeat, useAutomationSettings } from './useAutomation';

interface Props {
  potId: string;
  potName: string;
  onOpen?: () => void;
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

export function HeartbeatStatusWidget({ potId, potName, onOpen }: Props) {
  const { data: settings } = useAutomationSettings(potId);
  const { data: latest } = useLatestHeartbeat(potId);

  if (!settings?.enabled || !settings.heartbeat_enabled) return null;

  const snapshot = latest?.snapshot;
  const headline = (snapshot?.snapshot as any)?.headline;
  const openLoops: unknown[] = (snapshot?.snapshot as any)?.open_loops ?? [];

  const displayName = potName.length > 22 ? potName.slice(0, 22) + '…' : potName;

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        borderLeft: '3px solid var(--gold)',
        cursor: onOpen ? 'pointer' : 'default',
      }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {displayName}
          {onOpen && <span style={{ marginLeft: 4, opacity: 0.5 }}>›</span>}
        </span>
        {snapshot && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatAge(snapshot.created_at)}</span>
        )}
      </div>
      {headline ? (
        <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
          {headline.length > 80 ? headline.slice(0, 80) + '…' : headline}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No heartbeat yet</div>
      )}
      {openLoops.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {openLoops.length} open loop{openLoops.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
