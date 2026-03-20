import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ResearchRun,
  ResearchRunStatus,
  ResearchArtifact,
  ResearchNotification,
  ResearchSchedule,
  ResearchProgress,
} from '@/lib/types';
import './DeepResearchTab.css';

// ─── Model info (reused from Settings pattern) ────────────────────────────────

interface ModelInfo {
  id: number;
  name: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ResearchRunStatus[] = ['draft', 'planning', 'awaiting_approval', 'queued', 'running'];

function StatusBadge({ status }: { status: ResearchRunStatus }) {
  const labels: Record<ResearchRunStatus, string> = {
    draft: 'Draft',
    planning: 'Planning',
    awaiting_approval: 'Awaiting Approval',
    queued: 'Queued',
    running: 'Running',
    paused: 'Paused',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return (
    <span className={`dr-status-badge dr-status-badge--${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ─── Top-level tab component ──────────────────────────────────────────────────

interface DeepResearchTabProps {
  potId: string;
}

type View = 'list' | 'new' | 'detail';

export function DeepResearchTab({ potId }: DeepResearchTabProps) {
  const [view, setView] = useState<View>('list');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const openDetail = (runId: string) => {
    setSelectedRunId(runId);
    setView('detail');
  };

  if (view === 'new') {
    return (
      <NewRunForm
        potId={potId}
        onBack={() => setView('list')}
        onCreated={openDetail}
      />
    );
  }

  if (view === 'detail' && selectedRunId) {
    return (
      <RunDetail
        potId={potId}
        runId={selectedRunId}
        onBack={() => setView('list')}
      />
    );
  }

  return (
    <RunsList
      potId={potId}
      onNewRun={() => setView('new')}
      onViewRun={openDetail}
    />
  );
}

// ─── View A: Runs List ────────────────────────────────────────────────────────

interface RunsListProps {
  potId: string;
  onNewRun: () => void;
  onViewRun: (runId: string) => void;
}

function RunsList({ potId, onNewRun, onViewRun }: RunsListProps) {
  const { data: runsData } = useQuery({
    queryKey: ['research-runs', potId],
    queryFn: () =>
      api.get<{ runs: ResearchRun[]; total: number }>(
        `/research/runs?pot_id=${potId}&limit=20`
      ),
    enabled: !!potId,
    refetchInterval: (query) => {
      const runs = (query.state.data as { runs: ResearchRun[] } | undefined)?.runs ?? [];
      const hasActive = runs.some((r) => ACTIVE_STATUSES.includes(r.status));
      return hasActive ? 5000 : 15000;
    },
  });

  const runs = runsData?.runs ?? [];

  return (
    <div className="dr-tab">
      <div className="dr-tab__header">
        <h2 className="dr-tab__title">Deep Research Agent</h2>
        <button className="btn-primary" onClick={onNewRun}>
          + New Research Run
        </button>
      </div>

      {runs.length === 0 ? (
        <div className="dr-empty">
          <div className="dr-empty__icon">🔬</div>
          <h3>No research runs yet</h3>
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-2)' }}>
            Start a new run to begin deep research on this pot's content.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {runs.map((run) => (
            <div key={run.id} className="dr-run-card panel" onClick={() => onViewRun(run.id)}>
              <div className="dr-run-card__header">
                <p className="dr-run-card__goal">{run.goal_prompt}</p>
                <StatusBadge status={run.status} />
              </div>
              <div className="dr-run-card__footer">
                <span className="dr-run-card__date">Created {fmtDate(run.created_at)}</span>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewRun(run.id);
                  }}
                >
                  View →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ScheduleSection potId={potId} />
    </div>
  );
}

// ─── View B: New Run Form ─────────────────────────────────────────────────────

interface NewRunFormProps {
  potId: string;
  onBack: () => void;
  onCreated: (runId: string) => void;
}

interface AiSettingsCompact {
  default_model?: string;
  task_models?: { deep_research?: string };
}

function NewRunForm({ potId, onBack, onCreated }: NewRunFormProps) {
  const [goalPrompt, setGoalPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);
  const [webAugmentation, setWebAugmentation] = useState(false);
  const [depth, setDepth] = useState(3);
  const [breadth, setBreadth] = useState(4);
  const [error, setError] = useState<string | null>(null);

  const GOAL_MAX = 5000;

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api
        .get<{ models: ModelInfo[] }>('/models')
        .catch(() => ({ models: [] })),
  });

  const { data: aiSettings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () =>
      api.get<AiSettingsCompact>('/prefs/ai').catch((): AiSettingsCompact => ({})),
  });

  const resolvedDefault = aiSettings?.task_models?.deep_research || aiSettings?.default_model || '';

  const models = modelsData?.models ?? [];

  const createRun = useMutation({
    mutationFn: (body: object) =>
      api.post<{ run: ResearchRun }>('/research/runs', body),
    onSuccess: (result) => {
      onCreated(result.run.id);
    },
    onError: (err: any) => {
      setError(err?.message ?? 'Failed to start research run.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (goalPrompt.trim().length < 10) {
      setError('Goal prompt must be at least 10 characters.');
      return;
    }
    createRun.mutate({
      pot_id: potId,
      goal_prompt: goalPrompt.trim(),
      auto_approve_plan: autoApprovePlan,
      selected_model: selectedModel || undefined,
      config: {
        budget: {
          max_depth: depth,
          max_breadth: breadth,
        },
        web_augmentation_enabled: webAugmentation,
      },
    });
  };

  return (
    <div className="dr-tab">
      <div className="dr-tab__header">
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <h2 className="dr-tab__title">New Research Run</h2>
        <div style={{ width: 80 }} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="panel" style={{ padding: 'var(--space-4)' }}>
          <div className="form-field">
            <label style={{ fontWeight: 600, fontSize: 13 }}>Research Goal</label>
            <p className="text-muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
              Describe what you want to investigate. The AI will generate a research plan before executing.
            </p>
            <textarea
              rows={5}
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value.slice(0, GOAL_MAX))}
              placeholder="e.g. Investigate the key themes, contradictions, and open questions across all captured research about quantum computing…"
              disabled={createRun.isPending}
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  color: goalPrompt.length > GOAL_MAX * 0.9 ? 'var(--warning)' : 'var(--text-2)',
                }}
              >
                {goalPrompt.length} / {GOAL_MAX}
              </span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Configuration</h3>

          <div className="form-field">
            <label style={{ fontSize: 13, fontWeight: 500 }}>Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={createRun.isPending}
            >
              <option value="">
                {resolvedDefault
                  ? `Default: ${resolvedDefault}`
                  : 'Use AI preferences default'}
              </option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="form-field">
              <label style={{ fontSize: 13, fontWeight: 500 }}>Depth (1–5)</label>
              <input
                type="number"
                min={1}
                max={5}
                value={depth}
                onChange={(e) => setDepth(Math.min(5, Math.max(1, parseInt(e.target.value) || 3)))}
                disabled={createRun.isPending}
              />
            </div>
            <div className="form-field">
              <label style={{ fontSize: 13, fontWeight: 500 }}>Breadth (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={breadth}
                onChange={(e) => setBreadth(Math.min(10, Math.max(1, parseInt(e.target.value) || 4)))}
                disabled={createRun.isPending}
              />
            </div>
          </div>

          <div className="form-field">
            <label className="checkbox-label" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={autoApprovePlan}
                onChange={(e) => setAutoApprovePlan(e.target.checked)}
                disabled={createRun.isPending}
              />
              <span>Auto-approve plan (skip plan review step)</span>
            </label>
          </div>

          <div className="form-field">
            <label className="checkbox-label" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={webAugmentation}
                onChange={(e) => setWebAugmentation(e.target.checked)}
                disabled={createRun.isPending}
              />
              <span>Enable web augmentation (fetch external sources)</span>
            </label>
          </div>
        </div>

        {error && (
          <div className="settings-message settings-message--error">{error}</div>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={createRun.isPending || goalPrompt.trim().length < 10}
        >
          {createRun.isPending ? 'Starting…' : 'Start Research'}
        </button>
      </form>
    </div>
  );
}

// ─── View C: Run Detail ───────────────────────────────────────────────────────

interface RunDetailProps {
  potId: string;
  runId: string;
  onBack: () => void;
}

function RunDetail({ potId, runId, onBack }: RunDetailProps) {
  const queryClient = useQueryClient();

  const { data: runData, isLoading } = useQuery({
    queryKey: ['research-run', runId],
    queryFn: () => api.get<{ run: ResearchRun }>(`/research/runs/${runId}`),
    refetchInterval: (query) => {
      const run = (query.state.data as { run: ResearchRun } | undefined)?.run;
      if (!run) return 5000;
      const activeOrWaiting: ResearchRunStatus[] = [
        'draft',
        'planning',
        'queued',
        'awaiting_approval',
        'running',
        'paused',
      ];
      return activeOrWaiting.includes(run.status) ? 5000 : false;
    },
  });

  const run = runData?.run;

  // Mark unread notifications as read when viewing a done run
  const { data: notificationsData } = useQuery({
    queryKey: ['research-notifications-run', potId, runId],
    queryFn: () =>
      api.get<{ notifications: ResearchNotification[] }>(
        `/research/notifications?pot_id=${potId}&unread_only=true`
      ),
    enabled: run?.status === 'done',
  });

  useEffect(() => {
    if (!notificationsData) return;
    const toMark = notificationsData.notifications.filter((n) => n.run_id === runId);
    for (const n of toMark) {
      api
        .post(`/research/notifications/${n.id}/read`)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['research-notifications', potId] });
        })
        .catch(() => {});
    }
  }, [notificationsData, runId, potId, queryClient]);

  const approvePlan = useMutation({
    mutationFn: () => api.post(`/research/runs/${runId}/plan/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-run', runId] });
      queryClient.invalidateQueries({ queryKey: ['research-runs', potId] });
    },
  });

  const cancelRun = useMutation({
    mutationFn: () => api.post(`/research/runs/${runId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-run', runId] });
      queryClient.invalidateQueries({ queryKey: ['research-runs', potId] });
    },
  });

  const resumeRun = useMutation({
    mutationFn: () => api.post(`/research/runs/${runId}/resume`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-run', runId] });
      queryClient.invalidateQueries({ queryKey: ['research-runs', potId] });
    },
  });

  if (isLoading || !run) {
    return (
      <div className="dr-tab">
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <div className="dr-spinner">
          <span className="dr-spinner__icon">⟳</span>
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dr-tab">
      <div className="dr-tab__header">
        <button className="btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <StatusBadge status={run.status} />
            <span className="text-muted" style={{ fontSize: 12 }}>
              {fmtDate(run.created_at)}
            </span>
          </div>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text-0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {run.goal_prompt}
          </p>
        </div>
      </div>

      <div className="dr-detail-section">
        <RunStatusContent
          run={run}
          onApprove={() => approvePlan.mutate()}
          onCancel={() => cancelRun.mutate()}
          onResume={() => resumeRun.mutate()}
          approvePending={approvePlan.isPending}
          cancelPending={cancelRun.isPending}
          resumePending={resumeRun.isPending}
        />
      </div>
    </div>
  );
}

// ─── Status-driven content ────────────────────────────────────────────────────

interface RunStatusContentProps {
  run: ResearchRun;
  onApprove: () => void;
  onCancel: () => void;
  onResume: () => void;
  approvePending: boolean;
  cancelPending: boolean;
  resumePending: boolean;
}

function RunStatusContent({
  run,
  onApprove,
  onCancel,
  onResume,
  approvePending,
  cancelPending,
  resumePending,
}: RunStatusContentProps) {
  const { status } = run;

  if (status === 'draft' || status === 'planning') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div className="dr-spinner">
          <span className="dr-spinner__icon">⟳</span>
          <span style={{ fontSize: 14 }}>Generating research plan…</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            The AI is analysing your goal and the pot's contents.
          </span>
        </div>
        <button className="btn-secondary" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    );
  }

  if (status === 'awaiting_approval') {
    return <AwaitingApprovalView run={run} onApprove={onApprove} onCancel={onCancel} approvePending={approvePending} cancelPending={cancelPending} />;
  }

  if (status === 'queued') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div className="settings-message settings-message--info" style={{ width: '100%' }}>
          ⏳ Queued for execution — the worker will pick this up shortly.
        </div>
        <button className="btn-secondary" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    );
  }

  if (status === 'running') {
    return <RunningView runId={run.id} onCancel={onCancel} cancelPending={cancelPending} />;
  }

  if (status === 'paused') {
    return <PausedView run={run} onResume={onResume} onCancel={onCancel} resumePending={resumePending} cancelPending={cancelPending} />;
  }

  if (status === 'done') {
    return <DoneView run={run} />;
  }

  if (status === 'failed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="settings-message settings-message--error">
          ❌ This research run failed. Check the worker logs for details.
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="settings-message" style={{ margin: 0 }}>
        This research run was cancelled.
      </div>
    );
  }

  return null;
}

// ─── Awaiting approval view ───────────────────────────────────────────────────

function AwaitingApprovalView({
  run,
  onApprove,
  onCancel,
  approvePending,
  cancelPending,
}: {
  run: ResearchRun;
  onApprove: () => void;
  onCancel: () => void;
  approvePending: boolean;
  cancelPending: boolean;
}) {
  const { data: planData } = useQuery({
    queryKey: ['research-plan', run.id],
    queryFn: () =>
      api
        .get<{ artifact: ResearchArtifact }>(`/research/runs/${run.id}/plan`)
        .catch(() => null),
    enabled: !!run.id,
  });

  const plan = planData?.artifact?.payload as Record<string, unknown> | undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="settings-message settings-message--info" style={{ margin: 0 }}>
        The AI has generated a research plan. Review it below and approve to begin execution.
      </div>

      {plan ? (
        <div className="dr-plan-viewer">
          {!!plan.refined_goal && (
            <div className="dr-plan-field">
              <div className="dr-plan-field__label">Refined Goal</div>
              <div className="dr-plan-field__value">{String(plan.refined_goal)}</div>
            </div>
          )}

          {Array.isArray(plan.sub_questions) && plan.sub_questions.length > 0 && (
            <div className="dr-plan-field">
              <div className="dr-plan-field__label">Sub-questions ({plan.sub_questions.length})</div>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(plan.sub_questions as string[]).map((q, i) => (
                  <li key={i} style={{ fontSize: 13, color: 'var(--text-0)', lineHeight: 1.5 }}>{q}</li>
                ))}
              </ol>
            </div>
          )}

          {Array.isArray(plan.assumptions) && plan.assumptions.length > 0 && (
            <div className="dr-plan-field">
              <div className="dr-plan-field__label">Assumptions</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(plan.assumptions as string[]).map((a, i) => (
                  <li key={i} style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="dr-plan-stat-row">
            {plan.proposed_depth != null && (
              <div className="dr-plan-stat">
                <span className="dr-plan-stat__value">{String(plan.proposed_depth)}</span>
                <span className="dr-plan-stat__label">Depth</span>
              </div>
            )}
            {plan.proposed_breadth != null && (
              <div className="dr-plan-stat">
                <span className="dr-plan-stat__value">{String(plan.proposed_breadth)}</span>
                <span className="dr-plan-stat__label">Breadth</span>
              </div>
            )}
            {plan.estimated_entries_to_read != null && (
              <div className="dr-plan-stat">
                <span className="dr-plan-stat__value">{String(plan.estimated_entries_to_read)}</span>
                <span className="dr-plan-stat__label">Entries</span>
              </div>
            )}
            {plan.pot_entry_count != null && (
              <div className="dr-plan-stat">
                <span className="dr-plan-stat__value">{String(plan.pot_entry_count)}</span>
                <span className="dr-plan-stat__label">In Pot</span>
              </div>
            )}
            {!!plan.data_scope && (
              <div className="dr-plan-stat">
                <span className="dr-plan-stat__value" style={{ fontSize: 13 }}>
                  {plan.data_scope === 'pot_and_web' ? 'Pot + Web' : 'Pot Only'}
                </span>
                <span className="dr-plan-stat__label">Scope</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="dr-spinner">
          <span className="dr-spinner__icon">⟳</span>
          <span style={{ fontSize: 13 }}>Loading plan…</span>
        </div>
      )}

      <div className="dr-action-row">
        <button className="btn-primary" onClick={onApprove} disabled={approvePending || !plan}>
          {approvePending ? 'Approving…' : '✓ Approve Plan'}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// ─── Running view ─────────────────────────────────────────────────────────────

function RunningView({
  runId,
  onCancel,
  cancelPending,
}: {
  runId: string;
  onCancel: () => void;
  cancelPending: boolean;
}) {
  const { data: progressData } = useQuery({
    queryKey: ['research-progress', runId],
    queryFn: () =>
      api.get<{ run_id: string; status: string; progress: ResearchProgress; budget_usage: Record<string, unknown> }>(
        `/research/runs/${runId}/progress`
      ),
    refetchInterval: 5000,
  });

  const progress = progressData?.progress ?? {};
  const budgetUsage = progressData?.budget_usage ?? {};

  const budgetPct = (() => {
    const entriesRead = Number(budgetUsage.entries_read ?? 0);
    const maxEntries = 500; // default
    return Math.min(100, Math.round((entriesRead / maxEntries) * 100));
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="panel" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <span style={{ animation: 'dr-spin 1.2s linear infinite', display: 'inline-block', fontSize: 16 }}>⟳</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {progress.message || progress.phase || 'Running…'}
          </span>
        </div>

        {progress.current_query && (
          <p className="text-muted" style={{ fontSize: 12, marginBottom: 'var(--space-3)', fontStyle: 'italic' }}>
            "{truncate(progress.current_query, 120)}"
          </p>
        )}

        <div className="dr-progress-grid">
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">
              {progress.current_depth ?? 0}/{progress.total_depth ?? '?'}
            </div>
            <div className="dr-progress-cell__label">Depth</div>
          </div>
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">
              {progress.queries_completed ?? 0}
            </div>
            <div className="dr-progress-cell__label">Queries Run</div>
          </div>
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">
              {progress.learnings_count ?? 0}
            </div>
            <div className="dr-progress-cell__label">Learnings</div>
          </div>
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">
              {progress.entries_read ?? 0}
            </div>
            <div className="dr-progress-cell__label">Sources Read</div>
          </div>
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">
              {progress.pages_fetched ?? 0}
            </div>
            <div className="dr-progress-cell__label">Pages Fetched</div>
          </div>
          <div className="dr-progress-cell">
            <div className="dr-progress-cell__value">{budgetPct}%</div>
            <div className="dr-progress-cell__label">Budget Used</div>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
            <span>Budget</span>
            <span>{budgetPct}%</span>
          </div>
          <div className="dr-budget-bar-wrap">
            <div
              className={`dr-budget-bar${budgetPct > 80 ? ' dr-budget-bar--warn' : ''}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      </div>

      <button className="btn-secondary" onClick={onCancel} disabled={cancelPending} style={{ alignSelf: 'flex-start' }}>
        {cancelPending ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}

// ─── Paused view ──────────────────────────────────────────────────────────────

function PausedView({
  run,
  onResume,
  onCancel,
  resumePending,
  cancelPending,
}: {
  run: ResearchRun;
  onResume: () => void;
  onCancel: () => void;
  resumePending: boolean;
  cancelPending: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="settings-message settings-message--info" style={{ margin: 0 }}>
        ⏸ Budget limit reached — partial results are available. Resume to continue with the next depth level.
      </div>

      <div className="dr-action-row">
        <button className="btn-primary" onClick={onResume} disabled={resumePending}>
          {resumePending ? 'Resuming…' : '▶ Resume'}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>

      {run.report_artifact_id && <PartialReportView runId={run.id} />}
    </div>
  );
}

function PartialReportView({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ['research-report', runId],
    queryFn: () =>
      api
        .get<{ artifact: ResearchArtifact }>(`/research/runs/${runId}/report`)
        .catch(() => null),
  });

  const payload = data?.artifact?.payload as Record<string, unknown> | undefined;
  if (!payload) return null;

  return (
    <div className="dr-report">
      <p style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Partial Report
      </p>
      <ReportContent payload={payload} />
    </div>
  );
}

// ─── Done view ────────────────────────────────────────────────────────────────

function DoneView({ run }: { run: ResearchRun }) {
  const { data: reportData } = useQuery({
    queryKey: ['research-report', run.id],
    queryFn: () =>
      api
        .get<{ artifact: ResearchArtifact }>(`/research/runs/${run.id}/report`)
        .catch(() => null),
  });

  const { data: deltaData } = useQuery({
    queryKey: ['research-delta', run.id],
    queryFn: () =>
      api
        .get<{ artifact: ResearchArtifact }>(`/research/runs/${run.id}/delta`)
        .catch(() => null),
    enabled: !!run.delta_artifact_id,
  });

  const { data: noveltyData } = useQuery({
    queryKey: ['research-novelty', run.id],
    queryFn: () =>
      api
        .get<{ artifact: ResearchArtifact }>(`/research/runs/${run.id}/novelty`)
        .catch(() => null),
    enabled: !!run.novelty_artifact_id,
  });

  const reportPayload = reportData?.artifact?.payload as Record<string, unknown> | undefined;
  const deltaPayload = deltaData?.artifact?.payload as Record<string, unknown> | undefined;
  const noveltyPayload = noveltyData?.artifact?.payload as Record<string, unknown> | undefined;

  return (
    <div className="dr-report">
      {!!noveltyPayload && <NoveltyBadge payload={noveltyPayload} />}

      {reportPayload ? (
        <ReportContent payload={reportPayload} />
      ) : (
        <div className="dr-spinner">
          <span className="dr-spinner__icon">⟳</span>
          <span style={{ fontSize: 13 }}>Loading report…</span>
        </div>
      )}

      {!!deltaPayload && <DeltaContent payload={deltaPayload} />}
    </div>
  );
}

// ─── Report content ───────────────────────────────────────────────────────────

function ReportContent({ payload }: { payload: Record<string, unknown> }) {
  const learnings = Array.isArray(payload.learnings) ? payload.learnings as Array<Record<string, unknown>> : [];

  return (
    <>
      {!!payload.title && (
        <h2 className="dr-report__title">{String(payload.title)}</h2>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {learnings.length > 0 && (
          <span className="badge badge--gold">{learnings.length} learnings</span>
        )}
        {payload.entries_read_count != null && (
          <span className="badge">{String(payload.entries_read_count)} sources read</span>
        )}
        {!!payload.budget_hit && (
          <span className="badge badge--danger">Budget limit reached</span>
        )}
      </div>

      {!!payload.summary && (
        <p className="dr-report__summary">{String(payload.summary)}</p>
      )}

      {Array.isArray(payload.sections) && payload.sections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {(payload.sections as Array<{ heading: string; content: string }>).map((s, i) => (
            <div key={i} className="dr-report-section">
              <h3 className="dr-report-section__heading">{s.heading}</h3>
              <p className="dr-report-section__body">{s.content}</p>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(payload.open_loops) && payload.open_loops.length > 0 && (
        <div className="dr-report-section">
          <h3 className="dr-report-section__heading">Open Questions</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(payload.open_loops as string[]).map((q, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ─── Novelty badge ────────────────────────────────────────────────────────────

function NoveltyBadge({ payload }: { payload: Record<string, unknown> }) {
  const score = typeof payload.novelty_score === 'number' ? payload.novelty_score : null;
  const alert = typeof payload.alert === 'string' ? payload.alert : null;

  if (score === null) return null;

  const pct = Math.round(score * 100);
  const isLow = score < 0.3;

  return (
    <div className={`dr-novelty${isLow ? ' dr-novelty--low' : ''}`}>
      <div className="dr-novelty__score">{pct}%</div>
      <div className="dr-novelty__info">
        <div className="dr-novelty__label">Novelty Score</div>
        {alert && <div className="dr-novelty__desc">{alert}</div>}
        {!alert && (
          <div className="dr-novelty__desc">
            {isLow
              ? 'Most findings overlap with previous runs.'
              : 'Significant new findings compared to previous runs.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Delta content ────────────────────────────────────────────────────────────

function DeltaContent({ payload }: { payload: Record<string, unknown> }) {
  const newLearnings = Array.isArray(payload.new_learnings)
    ? (payload.new_learnings as Array<Record<string, unknown>>)
    : [];

  if (newLearnings.length === 0) return null;

  return (
    <div className="dr-delta">
      <div className="dr-delta__title">Delta — New Since Last Run ({newLearnings.length})</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {newLearnings.slice(0, 10).map((l, i) => (
          <li key={i} style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
            {String(l.text ?? '')}
          </li>
        ))}
        {newLearnings.length > 10 && (
          <li style={{ fontSize: 12, color: 'var(--text-2)' }}>
            + {newLearnings.length - 10} more…
          </li>
        )}
      </ul>
    </div>
  );
}

// ─── Schedule section ─────────────────────────────────────────────────────────

type CadenceType = 'none' | 'daily' | 'weekly';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildCronLike(cadence: CadenceType, time: string, dow: number): string | undefined {
  if (cadence === 'none') return undefined;
  const [hh, mm] = time.split(':').map(Number);
  const h = isNaN(hh) ? 9 : hh;
  const m = isNaN(mm) ? 0 : mm;
  if (cadence === 'daily') return `${m} ${h} * * *`;
  return `${m} ${h} * * ${dow}`;
}

function parseCronLike(cron: string | null): { cadence: CadenceType; time: string; dow: number } {
  if (!cron) return { cadence: 'none', time: '09:00', dow: 1 };
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return { cadence: 'none', time: '09:00', dow: 1 };
  const [m, h, , , d] = parts;
  const hh = String(Number(h)).padStart(2, '0');
  const mm = String(Number(m)).padStart(2, '0');
  const time = `${hh}:${mm}`;
  const dowVal = d === '*' ? 1 : Number(d);
  const cadence: CadenceType = d === '*' ? 'daily' : 'weekly';
  return { cadence, time, dow: isNaN(dowVal) ? 1 : dowVal };
}

function ScheduleSection({ potId }: { potId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: scheduleData } = useQuery({
    queryKey: ['research-schedule', potId],
    queryFn: () =>
      api
        .get<{ schedule: ResearchSchedule }>(`/research/schedules/${potId}`)
        .catch(() => null),
    enabled: !!potId,
  });

  const existing = scheduleData?.schedule ?? null;
  const parsed = parseCronLike(existing?.cron_like ?? null);

  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [cadence, setCadence] = useState<CadenceType>(parsed.cadence);
  const [time, setTime] = useState(parsed.time);
  const [dow, setDow] = useState(parsed.dow);
  const [timezone, setTimezone] = useState(existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
  const [autoApprove, setAutoApprove] = useState(existing?.auto_approve_plan ?? false);
  const [goalPrompt, setGoalPrompt] = useState(existing?.goal_prompt ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Sync form when schedule loads
  useEffect(() => {
    if (!existing) return;
    const p = parseCronLike(existing.cron_like);
    setCadence(p.cadence);
    setTime(p.time);
    setDow(p.dow);
    setEnabled(existing.enabled);
    setTimezone(existing.timezone);
    setAutoApprove(existing.auto_approve_plan);
    setGoalPrompt(existing.goal_prompt);
  }, [existing?.id]);

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      api.put<{ schedule: ResearchSchedule }>(`/research/schedules/${potId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-schedule', potId] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    },
    onError: () => {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 4000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/research/schedules/${potId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-schedule', potId] });
      setEnabled(false);
      setCadence('none');
    },
  });

  const handleSave = () => {
    if (!goalPrompt.trim()) {
      alert('Please enter a goal prompt for the schedule.');
      return;
    }
    setSaveStatus('saving');
    saveMutation.mutate({
      goal_prompt: goalPrompt.trim(),
      cron_like: buildCronLike(cadence, time, dow),
      timezone,
      auto_approve_plan: autoApprove,
      enabled,
    });
  };

  const handleDelete = () => {
    if (!existing) return;
    if (!window.confirm('Delete this research schedule?')) return;
    deleteMutation.mutate();
  };

  return (
    <div className="dr-schedule-section">
      <button className="dr-schedule-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="dr-schedule-toggle__label">
          {existing?.enabled ? '🕐 Schedule: Active' : '🕐 Recurring Schedule'}
        </span>
        <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="dr-schedule-form">
          <div className="form-field">
            <label style={{ fontSize: 13, fontWeight: 500 }}>Schedule Goal Prompt</label>
            <textarea
              rows={3}
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value.slice(0, 5000))}
              placeholder="Research goal for scheduled runs…"
            />
          </div>

          <div className="form-field">
            <label style={{ fontSize: 13, fontWeight: 500 }}>Cadence</label>
            <select value={cadence} onChange={(e) => setCadence(e.target.value as CadenceType)}>
              <option value="none">None (disabled)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {cadence !== 'none' && (
            <div style={{ display: 'grid', gridTemplateColumns: cadence === 'weekly' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-field">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Time (HH:MM)</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              {cadence === 'weekly' && (
                <div className="form-field">
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Day</label>
                  <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
                    {DAYS_OF_WEEK.map((day, i) => (
                      <option key={i} value={i}>{day}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-field">
                <label style={{ fontSize: 13, fontWeight: 500 }}>Timezone</label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </div>
            </div>
          )}

          <div className="form-field">
            <label className="checkbox-label" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
              />
              <span>Auto-approve plan (skip review)</span>
            </label>
          </div>

          <div className="form-field">
            <label className="checkbox-label" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Schedule enabled</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveStatus === 'saving' ? 'Saving…' : 'Save Schedule'}
            </button>
            {existing && (
              <button className="btn-secondary" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Schedule'}
              </button>
            )}
            {saveStatus === 'saved' && (
              <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ Saved</span>
            )}
            {saveStatus === 'error' && (
              <span style={{ fontSize: 13, color: 'var(--danger)' }}>Failed to save</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
