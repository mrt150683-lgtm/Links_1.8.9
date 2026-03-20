/**
 * MomStatusStrip
 *
 * Shows the current MoM (Mixture of Models) execution progress inline
 * above the composer. Collapses to a badge when the run is complete.
 */

import { useEffect, useState } from 'react';
import './MomStatusStrip.css';

export type MomStage = 'Planning' | 'Parallel analysis' | 'Merging' | 'Complete' | 'Failed' | 'Initializing';

interface MomStatusStripProps {
  runId: string | null;
  isLoading?: boolean;
  agentCount?: number;
  onViewTrace?: (runId: string) => void;
  /** Called when the run reaches 'done' OR 'failed' — triggers UI to re-fetch messages */
  onComplete?: (runId: string) => void;
  onCancel?: (runId: string) => void;
}

interface RunStatus {
  status: string;
  stage: MomStage;
  agent_count: number;
  done_count: number;
  failed_count: number;
  error_message: string | null;
  finished_at: number | null;
}

const STAGE_ORDER: MomStage[] = ['Initializing', 'Planning', 'Parallel analysis', 'Merging', 'Complete'];

function StageStep({ label, current, done }: { label: string; current: boolean; done: boolean }) {
  return (
    <span className={`mom-strip__stage ${current ? 'mom-strip__stage--current' : ''} ${done ? 'mom-strip__stage--done' : ''}`}>
      {done && <span className="mom-strip__check">✓</span>}
      {current && <span className="mom-strip__spinner" />}
      {label}
    </span>
  );
}

export default function MomStatusStrip({ runId, isLoading, onViewTrace, onComplete, onCancel }: MomStatusStripProps) {
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setCollapsed(false);
    setRunStatus(null);
    setCancelling(false);

    let alive = true;
    let terminalFired = false;

    async function poll() {
      if (!runId || !alive) return;
      try {
        const res = await fetch(`/api/mom/runs/${runId}/status`);
        if (!res.ok) return;
        const data: RunStatus = await res.json();
        if (alive) setRunStatus(data);
        // Fire onComplete on both done AND failed — so the UI re-fetches
        // the placeholder message that the worker updated in the DB.
        if ((data.status === 'done' || data.status === 'failed') && !terminalFired) {
          terminalFired = true;
          onComplete?.(runId);
        }
        // Keep polling while not terminal
        if (data.status !== 'done' && data.status !== 'failed' && data.status !== 'cancelled') {
          setTimeout(poll, 1500);
        }
      } catch {
        // non-fatal
      }
    }

    poll();
    return () => { alive = false; };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCancel() {
    if (!runId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/mom/runs/${runId}/cancel`, { method: 'POST' });
      onCancel?.(runId);
    } catch { /* non-fatal */ }
  }

  if (!runId && !isLoading) return null;

  // When isLoading but no runId yet (Lite's synchronous wait), show Planning as active
  const stage: MomStage = runStatus?.stage ?? (isLoading && !runId ? 'Planning' : 'Initializing');
  const agentCount = runStatus?.agent_count ?? 0;
  const doneCount = runStatus?.done_count ?? 0;
  const isFailed = runStatus?.status === 'failed';
  const isDone = runStatus?.status === 'done';

  if (collapsed && isDone) {
    return (
      <div className="mom-strip mom-strip--badge" onClick={() => setCollapsed(false)} title="Show MoM trace">
        <span className="mom-strip__badge-icon">◈</span>
        MoM · {agentCount} Agents
        {onViewTrace && runId && (
          <button
            className="mom-strip__trace-btn"
            onClick={(e) => { e.stopPropagation(); onViewTrace(runId); }}
          >
            View trace
          </button>
        )}
      </div>
    );
  }

  const currentIdx = STAGE_ORDER.indexOf(stage);

  return (
    <div className={`mom-strip ${isFailed ? 'mom-strip--failed' : ''} ${isDone ? 'mom-strip--done' : ''}`}>
      <div className="mom-strip__header">
        <span className="mom-strip__label">
          ◈ MoM Active{agentCount > 0 ? ` · ${agentCount} Agents` : ''}
        </span>
        {agentCount > 0 && doneCount > 0 && !isDone && (
          <span className="mom-strip__progress">{doneCount}/{agentCount}</span>
        )}
        {!isDone && !isFailed && runId && (
          <button className="mom-strip__cancel" onClick={handleCancel} disabled={cancelling} title="Cancel run">
            {cancelling ? '…' : '✕'}
          </button>
        )}
        <button className="mom-strip__collapse" onClick={() => setCollapsed(true)} title="Collapse">−</button>
      </div>

      <div className="mom-strip__stages">
        {STAGE_ORDER.filter((s) => s !== 'Initializing').map((s) => {
          const stageIdx = STAGE_ORDER.indexOf(s);
          return (
            <StageStep
              key={s}
              label={s}
              current={stage === s && !isDone && !isFailed}
              done={currentIdx > stageIdx || isDone}
            />
          );
        })}
      </div>

      {isFailed && runStatus?.error_message && (
        <div className="mom-strip__error">{runStatus.error_message}</div>
      )}

      {isDone && onViewTrace && runId && (
        <button
          className="mom-strip__trace-btn mom-strip__trace-btn--inline"
          onClick={() => onViewTrace(runId)}
        >
          View trace
        </button>
      )}
    </div>
  );
}
