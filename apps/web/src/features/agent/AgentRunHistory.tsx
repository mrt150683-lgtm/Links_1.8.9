/**
 * AgentRunHistory
 *
 * Table of agent runs for a pot with status, duration, phase, and expandable step log.
 */

import { useState } from 'react';
import { useAgentRuns, useCancelAgentRun } from './useAgent';
import type { AgentRun } from './useAgent';
import './agent.css';

interface Step {
  ts: number;
  phase: string;
  detail: string;
  ok: boolean;
}

interface Props {
  potId: string;
}

export function AgentRunHistory({ potId }: Props) {
  const { data, isLoading } = useAgentRuns(potId);
  const cancelMut = useCancelAgentRun();

  if (isLoading) return <div className="agent-loading">Loading runs…</div>;
  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    return <div className="agent-page__empty">No agent runs yet. Enable the agent and click Run Now.</div>;
  }

  return (
    <div className="agent-run-history">
      {runs.map((r) => (
        <RunRow key={r.id} run={r} onCancel={() => cancelMut.mutate(r.id)} />
      ))}
    </div>
  );
}

function RunRow({ run: r, onCancel }: { run: AgentRun; onCancel: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = ['pending', 'running', 'paused'].includes(r.status);
  const created = new Date(r.created_at).toLocaleString();
  const duration =
    r.finished_at && r.started_at
      ? `${Math.round((r.finished_at - r.started_at) / 1000)}s`
      : isActive
        ? 'running…'
        : '—';

  const progress = r.progress as {
    phase?: string;
    candidates_generated?: number;
    reflection_artifact_id?: string;
    outcome?: string;
    error?: string;
    steps?: Step[];
  } | null;

  const phase = progress?.phase;
  const candidatesGenerated = progress?.candidates_generated;
  const steps: Step[] = progress?.steps ?? [];
  const hasSteps = steps.length > 0;

  function phaseLabel(p: string): string {
    if (p === 'done') return candidatesGenerated != null ? `${candidatesGenerated} candidates` : 'done';
    if (p === 'tool_build_done') return 'tool built';
    return p.replace(/_/g, ' ');
  }

  return (
    <div className="agent-run-row-wrap">
      <div className="agent-run-row">
        <span className={`agent-run-row__status agent-run-row__status--${r.status}`}>
          {r.status}
        </span>
        <span className="agent-run-row__type">{r.run_type.replace(/_/g, ' ')}</span>
        <span className="agent-run-row__time">{created}</span>
        <span className="agent-run-row__time">{duration}</span>
        {phase && (
          <span className="agent-run-row__phase">
            {phaseLabel(phase)}
          </span>
        )}
        <div className="agent-run-row__actions">
          {hasSteps && (
            <button
              className="agent-run-row__log-btn"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? 'Hide log' : 'Show log'}
            >
              {expanded ? '▲' : '▼'} log
            </button>
          )}
          {isActive && (
            <button className="agent-run-row__cancel-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {expanded && hasSteps && (
        <div className="agent-run-log">
          {steps.map((s, i) => (
            <div key={i} className={`agent-run-log__step agent-run-log__step--${s.ok ? 'ok' : 'err'}`}>
              <span className="agent-run-log__step-icon">{s.ok ? '✓' : '✗'}</span>
              <span className="agent-run-log__step-phase">{s.phase.replace(/_/g, ' ')}</span>
              <span className="agent-run-log__step-detail">{s.detail}</span>
              <span className="agent-run-log__step-time">
                {new Date(s.ts).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
