import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScoutPreferences, ForgeRunRow, ForgePackRow } from '@/lib/types';

interface ModelInfo {
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
}

interface ForgeResult {
  run_id: string;
  packs_generated: number;
}

interface Props {
  tokenConfigured: boolean;
  prefs: ScoutPreferences | null;
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.7) return 'scout-score-badge--high';
  if (score >= 0.4) return 'scout-score-badge--mid';
  return 'scout-score-badge--low';
}

function safeParseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as string[];
    if (typeof parsed === 'string') return [parsed];
    return [];
  } catch {
    return [];
  }
}

function parseRepoCount(json: string | null): number {
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function ScoutForge({ tokenConfigured, prefs }: Props) {
  const [repoName, setRepoName] = useState('');
  const [model, setModel] = useState('');
  const [focus, setFocus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxQueries, setMaxQueries] = useState('');
  const [topN, setTopN] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const effectiveModel = model || prefs?.default_model || '';

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<ModelsResponse>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const { data: forgeRunsData } = useQuery({
    queryKey: ['forge-runs'],
    queryFn: () =>
      api.get<{ runs: ForgeRunRow[] }>('/scout/forge/runs').catch(() => ({ runs: [] })),
  });

  const forgeRuns = forgeRunsData?.runs ?? [];

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<ForgeResult>('/scout/forge/runs', body),
  });

  if (!tokenConfigured) {
    return (
      <div className="scout-empty">
        <h3>GitHub Token Required</h3>
        <p>Configure your GitHub token in the Settings tab to use Forge.</p>
      </div>
    );
  }

  // ── Pack detail view ──────────────────────────────────────────────────
  if (selectedRunId) {
    return (
      <ForgePacksView
        runId={selectedRunId}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  const handleStart = () => {
    if (!repoName.trim() || !effectiveModel) return;

    const body: Record<string, unknown> = {
      repo_full_name: repoName.trim(),
      model: effectiveModel,
    };
    if (focus.trim()) body.focus = focus.trim();
    if (maxQueries) body.maxQueries = parseInt(maxQueries);
    if (topN) body.topN = parseInt(topN);

    runMutation.mutate(body);
  };

  return (
    <div>
      {runMutation.isSuccess && runMutation.data && (
        <div className="scout-result-summary panel" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="scout-result-summary__title">Forge Run Complete</div>
          <p className="text-muted" style={{ margin: 0 }}>
            Run <code>{runMutation.data.run_id.slice(0, 8)}</code> &mdash;{' '}
            {runMutation.data.packs_generated} packs generated.
          </p>
        </div>
      )}

      <div className="settings-group panel" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 className="settings-group__title">New Forge Run</h3>
        <p className="text-muted">
          Enter a seed repository to find complementary packages and generate integration packs.
        </p>

        <div className="scout-form">
          <div className="form-field">
            <label>Repository (owner/repo)</label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="e.g. facebook/react"
              disabled={runMutation.isPending}
            />
          </div>

          <div className="form-field">
            <label>Model</label>
            <select
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
              disabled={models.length === 0 || runMutation.isPending}
            >
              <option value="">Select a model</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Focus (optional)</label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. state management, testing"
              disabled={runMutation.isPending}
            />
          </div>

          <button
            className="scout-advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>

          {showAdvanced && (
            <div className="scout-form__row">
              <div className="form-field">
                <label>Max Queries</label>
                <input
                  type="number"
                  min="1"
                  value={maxQueries}
                  onChange={(e) => setMaxQueries(e.target.value)}
                  placeholder="5"
                  disabled={runMutation.isPending}
                />
              </div>
              <div className="form-field">
                <label>Top N</label>
                <input
                  type="number"
                  min="1"
                  value={topN}
                  onChange={(e) => setTopN(e.target.value)}
                  placeholder="10"
                  disabled={runMutation.isPending}
                />
              </div>
            </div>
          )}

          <div>
            <button
              className="btn-primary"
              onClick={handleStart}
              disabled={!repoName.trim() || !effectiveModel || runMutation.isPending}
            >
              {runMutation.isPending ? 'Running Forge...' : 'Start Forge Run'}
            </button>
          </div>
        </div>
      </div>

      {runMutation.isPending && (
        <div className="scout-loading">
          <div className="scout-spinner" />
          <p>Running Forge analysis... this may take a minute or two.</p>
        </div>
      )}

      {runMutation.isError && (
        <div className="settings-group panel" style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ color: 'var(--danger)', margin: '0 0 8px 0', fontWeight: 600 }}>
            Forge failed: {(runMutation.error as Error).message}
          </p>
          {/unauthorized/i.test((runMutation.error as Error).message) && (
            <div className="settings-message settings-message--info" style={{ marginTop: 0 }}>
              <strong>Token invalid or revoked.</strong> GitHub rejected the token entirely.
              <ol style={{ paddingLeft: '20px', margin: '8px 0 0 0', lineHeight: '1.6' }}>
                <li>Go to <strong>Settings → Scout Settings</strong> and check the token hint shown there.</li>
                <li>If it looks wrong, clear it and paste a fresh token.</li>
                <li>
                  Create a new Classic PAT at{' '}
                  <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer"
                     style={{ color: 'var(--gold-1)' }}>
                    github.com/settings/tokens/new
                  </a>{' '}
                  — for private repos check the <code>repo</code> scope.
                </li>
              </ol>
            </div>
          )}
          {/not found/i.test((runMutation.error as Error).message) && (
            <div className="settings-message settings-message--info" style={{ marginTop: 0 }}>
              <strong>Private repository?</strong> GitHub returns "Not Found" for private repos when the
              token lacks the <code>repo</code> scope. To access private repos:
              <ol style={{ paddingLeft: '20px', margin: '8px 0 0 0', lineHeight: '1.6' }}>
                <li>Go to <strong>Settings → Scout Settings</strong> and clear the current token.</li>
                <li>
                  Create a new Classic PAT at{' '}
                  <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer"
                     style={{ color: 'var(--gold-1)' }}>
                    github.com/settings/tokens/new
                  </a>{' '}
                  with the <code>repo</code> scope checked.
                </li>
                <li>Save the new token in Scout Settings.</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Past runs */}
      {forgeRuns.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 var(--space-3) 0', color: 'var(--text-0)' }}>Past Forge Runs</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {forgeRuns.map((run) => (
              <div
                key={run.run_id}
                className="scout-run-card panel"
                onClick={() => setSelectedRunId(run.run_id)}
              >
                <div className="scout-run-card__header">
                  <span className="scout-run-card__query">
                    {run.seed_repo_full_name || run.seed_text || run.mode}
                  </span>
                  <span className="scout-run-card__date">
                    {new Date(run.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
                  {run.mode} &mdash; {run.run_id.slice(0, 8)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Packs view ────────────────────────────────────────────────────────

function ForgePacksView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { data: packsData, isLoading } = useQuery({
    queryKey: ['forge-packs', runId],
    queryFn: () =>
      api.get<{ packs: ForgePackRow[] }>(`/scout/forge/runs/${runId}/packs`)
        .catch(() => ({ packs: [] })),
  });

  const packs = Array.isArray(packsData?.packs) ? packsData.packs : [];

  return (
    <div>
      <button className="scout-back-btn" onClick={onBack}>
        &larr; Back to Forge Runs
      </button>

      <h3 style={{ margin: '0 0 var(--space-4) 0', color: 'var(--text-0)' }}>
        Packs for Run {runId.slice(0, 8)}
      </h3>

      {isLoading && (
        <div className="scout-loading">
          <div className="scout-spinner" />
          <p>Loading packs...</p>
        </div>
      )}

      {!isLoading && packs.length === 0 && (
        <div className="scout-empty">
          <h3>No Packs</h3>
          <p>This Forge run did not generate any packs.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {packs.map((pack) => (
          <PackCard key={pack.pack_id} pack={pack} />
        ))}
      </div>
    </div>
  );
}

function PackCard({ pack }: { pack: ForgePackRow }) {
  const [expanded, setExpanded] = useState(false);
  const repoCount = parseRepoCount(pack.repo_ids_json);
  const reasons = safeParseJsonArray(pack.reasons_json);

  return (
    <div className="scout-pack-card panel">
      <div className="scout-pack-card__header">
        <span className={`scout-score-badge ${scoreBadgeClass(pack.score)}`}>
          Score: {(pack.score * 100).toFixed(0)}
        </span>
        <span className="text-muted" style={{ fontSize: '12px' }}>
          {new Date(pack.created_at).toLocaleString()}
        </span>
      </div>

      {repoCount > 0 && (
        <p className="text-muted" style={{ margin: '0 0 var(--space-2) 0', fontSize: '13px' }}>
          {repoCount} repositor{repoCount === 1 ? 'y' : 'ies'} in this pack
        </p>
      )}

      {reasons.length > 0 && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <strong style={{ fontSize: '12px', color: 'var(--text-1)' }}>Synergy Reasoning:</strong>
          {reasons.length === 1 ? (
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-1)', lineHeight: '1.5' }}>
              {reasons[0]}
            </p>
          ) : (
            <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '13px', color: 'var(--text-1)' }}>
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pack.merge_plan_md && (
        <>
          <button
            className="scout-advanced-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse' : 'Expand'} Merge Plan
          </button>
          {expanded && (
            <div className="scout-md-content" style={{ marginTop: 'var(--space-2)' }}>
              {pack.merge_plan_md}
            </div>
          )}
        </>
      )}
    </div>
  );
}
