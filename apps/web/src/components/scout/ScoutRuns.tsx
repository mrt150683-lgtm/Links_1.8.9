import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScoutRunRow, ScoutStepRow, ScoutBriefRow } from '@/lib/types';

interface ModelInfo {
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
}

interface Props {
  tokenConfigured: boolean;
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.7) return 'scout-score-badge--high';
  if (score >= 0.4) return 'scout-score-badge--mid';
  return 'scout-score-badge--low';
}

function stepStatusClass(status: string): string {
  if (status === 'success' || status === 'done') return 'scout-step__status--success';
  if (status === 'failed' || status === 'error') return 'scout-step__status--failed';
  if (status === 'running') return 'scout-step__status--running';
  return 'scout-step__status--skipped';
}

function parseRunLabel(argsJson: string): string {
  try {
    const args = JSON.parse(argsJson);
    if (args.query) return args.query as string;
    if (args.repo_full_name) return `Forge: ${args.repo_full_name as string}`;
    return '(unnamed run)';
  } catch {
    return '(unknown)';
  }
}

function safeParseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as string[];
    if (typeof parsed === 'string') return [parsed];
    return [];
  } catch {
    return [];
  }
}

export function ScoutRuns({ tokenConfigured }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [briefModel, setBriefModel] = useState('');

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['scout-runs'],
    queryFn: () => api.get<{ runs: ScoutRunRow[] }>('/scout/runs'),
  });

  const runs = runsData?.runs ?? [];

  // ── Detail view ──────────────────────────────────────────────────────
  if (selectedRunId) {
    return (
      <RunDetail
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
        briefModel={briefModel}
        setBriefModel={setBriefModel}
      />
    );
  }

  // ── List view ────────────────────────────────────────────────────────
  if (!tokenConfigured && runs.length === 0) {
    return (
      <div className="scout-empty">
        <h3>No Runs Yet</h3>
        <p>Configure your GitHub token in Settings, then start a discovery run.</p>
      </div>
    );
  }

  if (runsLoading) {
    return (
      <div className="scout-loading">
        <div className="scout-spinner" />
        <p>Loading runs...</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="scout-empty">
        <h3>No Runs Yet</h3>
        <p>Start a discovery from the Discovery tab to see results here.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {runs.map((run) => (
        <div
          key={run.run_id}
          className="scout-run-card panel"
          onClick={() => setSelectedRunId(run.run_id)}
        >
          <div className="scout-run-card__header">
            <span className="scout-run-card__query">{parseRunLabel(run.args_json)}</span>
            <span className="scout-run-card__date">
              {new Date(run.created_at).toLocaleString()}
            </span>
          </div>
          <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
            Run {run.run_id.slice(0, 8)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Run Detail sub-component ─────────────────────────────────────────

interface RunDetailProps {
  runId: string;
  onBack: () => void;
  briefModel: string;
  setBriefModel: (m: string) => void;
}

function RunDetail({ runId, onBack, briefModel, setBriefModel }: RunDetailProps) {
  const queryClient = useQueryClient();

  const { data: runData } = useQuery({
    queryKey: ['scout-run', runId],
    queryFn: () =>
      api.get<{ run: ScoutRunRow; steps: ScoutStepRow[] }>(`/scout/runs/${runId}`),
  });

  const { data: briefsData, isLoading: briefsLoading } = useQuery({
    queryKey: ['scout-briefs', runId],
    queryFn: () =>
      api.get<{ briefs: ScoutBriefRow[] }>(`/scout/runs/${runId}/briefs`),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<ModelsResponse>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const generateBriefs = useMutation({
    mutationFn: (body: { model: string }) =>
      api.post(`/scout/runs/${runId}/briefs`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scout-briefs', runId] });
    },
  });

  const run = runData?.run;
  const steps = runData?.steps ?? [];
  const briefs = briefsData?.briefs ?? [];

  return (
    <div>
      <button className="scout-back-btn" onClick={onBack}>
        &larr; Back to Runs
      </button>

      {run && (
        <div className="settings-group panel" style={{ marginBottom: 'var(--space-4)' }}>
          <h3 className="settings-group__title">
            {parseRunLabel(run.args_json)}
          </h3>
          <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
            {new Date(run.created_at).toLocaleString()} &mdash; {run.run_id}
          </p>
        </div>
      )}

      {/* Steps timeline */}
      {steps.length > 0 && (
        <div className="settings-group panel" style={{ marginBottom: 'var(--space-4)' }}>
          <h3 className="settings-group__title">Steps</h3>
          <div className="scout-steps">
            {steps.map((step) => (
              <div key={step.step_id} className="scout-step">
                <span className="scout-step__name">{step.name}</span>
                <span className={`scout-step__status ${stepStatusClass(step.status)}`}>
                  {step.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Briefs */}
      <div className="settings-group panel" style={{ marginBottom: 'var(--space-4)' }}>
        <h3 className="settings-group__title">Briefs</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div className="form-field" style={{ flex: 1 }}>
            <label>Model</label>
            <select
              value={briefModel}
              onChange={(e) => setBriefModel(e.target.value)}
              disabled={models.length === 0 || generateBriefs.isPending}
            >
              <option value="">Select model</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            onClick={() => generateBriefs.mutate({ model: briefModel })}
            disabled={!briefModel || generateBriefs.isPending}
            style={{ marginBottom: '8px' }}
          >
            {generateBriefs.isPending ? 'Generating...' : 'Generate Briefs'}
          </button>
        </div>

        {generateBriefs.isError && (
          <p style={{ color: 'var(--danger)', fontSize: '13px' }}>
            Failed: {(generateBriefs.error as Error).message}
          </p>
        )}
      </div>

      {/* Briefs list */}
      {briefsLoading && (
        <div className="scout-loading">
          <div className="scout-spinner" />
          <p>Loading briefs...</p>
        </div>
      )}

      {briefs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {briefs.map((brief) => (
            <BriefCard key={brief.brief_id} brief={brief} />
          ))}
        </div>
      )}

      {!briefsLoading && briefs.length === 0 && (
        <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          No briefs yet. Generate briefs above to see analysis results.
        </p>
      )}
    </div>
  );
}

function BriefCard({ brief }: { brief: ScoutBriefRow }) {
  const [expanded, setExpanded] = useState(false);
  const repos = safeParseJsonArray(brief.repo_ids_json);

  return (
    <div className="scout-brief-card panel">
      <div className="scout-brief-card__header">
        <span className={`scout-score-badge ${scoreBadgeClass(brief.score)}`}>
          Score: {(brief.score * 100).toFixed(0)}
        </span>
        <span className="text-muted" style={{ fontSize: '12px' }}>
          {new Date(brief.created_at).toLocaleString()}
        </span>
      </div>

      {repos.length > 0 && (
        <div className="scout-repos-list">
          {repos.map((r, i) => (
            <span key={i} className="scout-repo-chip">{r}</span>
          ))}
        </div>
      )}

      {brief.brief_md && (
        <>
          <button
            className="scout-advanced-toggle"
            onClick={() => setExpanded(!expanded)}
            style={{ marginBottom: 'var(--space-2)' }}
          >
            {expanded ? 'Collapse' : 'Expand'} Brief
          </button>
          {expanded && (
            <div className="scout-md-content">{brief.brief_md}</div>
          )}
        </>
      )}

      {brief.outreach_md && expanded && (
        <>
          <h4 style={{ margin: 'var(--space-3) 0 var(--space-2) 0', fontSize: '13px', color: 'var(--gold-1)' }}>
            Outreach
          </h4>
          <div className="scout-md-content">{brief.outreach_md}</div>
        </>
      )}
    </div>
  );
}
