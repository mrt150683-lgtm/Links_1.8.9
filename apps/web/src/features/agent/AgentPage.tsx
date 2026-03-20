/**
 * AgentPage
 *
 * Full agent management page for a pot.
 * Shows: run history, candidate list, tool library.
 * Accessed via /pots/:potId?tab=agent or a dedicated route.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AgentRunHistory } from './AgentRunHistory';
import { AgentToolLibrary } from './AgentToolLibrary';
import { AgentSurpriseWidget } from './AgentSurpriseWidget';
import { AgentCandidatesList } from './AgentCandidatesList';
import { AgentSnapshotReport } from './AgentSnapshotReport';
import './agent.css';

type View = 'overview' | 'history' | 'candidates' | 'tools' | 'snapshots';

interface Props {
  potId?: string;
}

export function AgentPage({ potId: propPotId }: Props) {
  const params = useParams<{ potId: string }>();
  const potId = propPotId ?? params.potId ?? '';
  const [view, setView] = useState<View>('overview');

  if (!potId) return null;

  return (
    <div className="agent-page">
      <div className="agent-page__header">
        <div className="agent-page__title">Autonomous Agent</div>
        <div className="agent-page__subtitle">
          Nightly reflection, insights, and workflow automation for this pot.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {(['overview', 'history', 'candidates', 'tools', 'snapshots'] as View[]).map((v) => (
          <button
            key={v}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 12,
              border: '1px solid var(--border, #3a3a3a)',
              background: view === v ? 'rgba(201,162,39,0.1)' : 'transparent',
              color: view === v ? 'var(--gold, #c9a227)' : 'var(--text-muted, #888)',
              borderColor: view === v ? 'var(--gold, #c9a227)' : 'var(--border, #3a3a3a)',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <>
          <div className="agent-page__section-title">Today's Insight</div>
          <AgentSurpriseWidget potId={potId} />

          <div className="agent-page__section-title">Recent Runs</div>
          <AgentRunHistory potId={potId} />
        </>
      )}

      {view === 'history' && (
        <>
          <div className="agent-page__section-title">Run History</div>
          <AgentRunHistory potId={potId} />
        </>
      )}

      {view === 'candidates' && (
        <>
          <div className="agent-page__section-title">All Candidates</div>
          <AgentCandidatesList potId={potId} />
        </>
      )}

      {view === 'tools' && (
        <>
          <div className="agent-page__section-title">Generated Tools</div>
          <AgentToolLibrary potId={potId} />
        </>
      )}

      {view === 'snapshots' && (
        <>
          <div className="agent-page__section-title">Pot Snapshots</div>
          <AgentSnapshotReport potId={potId} />
        </>
      )}
    </div>
  );
}
