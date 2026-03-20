import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScoutPreferences } from '@/lib/types';

interface ModelInfo {
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
}

interface DiscoveryResult {
  run_id: string;
  pass1: { repos_found?: number };
  analysis: { analyzed?: number };
}

interface Props {
  tokenConfigured: boolean;
  prefs: ScoutPreferences | null;
}

export function ScoutDiscovery({ tokenConfigured, prefs }: Props) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [days, setDays] = useState('');
  const [stars, setStars] = useState('');
  const [maxStars, setMaxStars] = useState('');
  const [topN, setTopN] = useState('');
  const [language, setLanguage] = useState('');
  const [includeForks, setIncludeForks] = useState(false);

  // Pre-fill from prefs
  const effectiveModel = model || prefs?.default_model || '';

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<ModelsResponse>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<DiscoveryResult>('/scout/runs', body),
  });

  if (!tokenConfigured) {
    return (
      <div className="scout-empty">
        <h3>GitHub Token Required</h3>
        <p>Configure your GitHub token in the Settings tab to start discovering repositories.</p>
      </div>
    );
  }

  const handleStart = () => {
    if (!query.trim()) return;

    const selectedModel = effectiveModel;
    if (!selectedModel) return;

    const body: Record<string, unknown> = {
      query: query.trim(),
      model: selectedModel,
    };

    const d = days || prefs?.default_days?.toString();
    const s = stars || prefs?.default_stars?.toString();
    const ms = maxStars || prefs?.default_max_stars?.toString();
    const tn = topN || prefs?.default_top_n?.toString();
    const lang = language || prefs?.default_language;
    const forks = includeForks || prefs?.default_include_forks;

    if (d) body.days = parseInt(d);
    if (s) body.stars = parseInt(s);
    if (ms) body.maxStars = parseInt(ms);
    if (tn) body.topN = parseInt(tn);
    if (lang) body.language = lang;
    if (forks) body.includeForks = true;

    runMutation.mutate(body);
  };

  return (
    <div>
      {runMutation.isSuccess && runMutation.data && (
        <div className="scout-result-summary panel" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="scout-result-summary__title">Discovery Complete</div>
          <p className="text-muted" style={{ margin: 0 }}>
            Run <code>{runMutation.data.run_id.slice(0, 8)}</code> &mdash;{' '}
            {runMutation.data.pass1?.repos_found ?? 0} repos found,{' '}
            {runMutation.data.analysis?.analyzed ?? 0} analyzed.
            Switch to the <strong>Runs</strong> tab to view details.
          </p>
        </div>
      )}

      <div className="settings-group panel">
        <h3 className="settings-group__title">New Discovery Run</h3>
        <p className="text-muted">
          Search GitHub for interesting repositories matching your query.
        </p>

        <div className="scout-form">
          <div className="form-field">
            <label>Search Query</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "local-first CRDT sync engine"'
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

          <button
            className="scout-advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>

          {showAdvanced && (
            <div className="scout-form__row">
              <div className="form-field">
                <label>Days</label>
                <input
                  type="number"
                  min="1"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder={prefs?.default_days?.toString() ?? '30'}
                  disabled={runMutation.isPending}
                />
              </div>
              <div className="form-field">
                <label>Min Stars</label>
                <input
                  type="number"
                  min="0"
                  value={stars}
                  onChange={(e) => setStars(e.target.value)}
                  placeholder={prefs?.default_stars?.toString() ?? '10'}
                  disabled={runMutation.isPending}
                />
              </div>
              <div className="form-field">
                <label>Max Stars</label>
                <input
                  type="number"
                  min="0"
                  value={maxStars}
                  onChange={(e) => setMaxStars(e.target.value)}
                  placeholder={prefs?.default_max_stars?.toString() ?? ''}
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
                  placeholder={prefs?.default_top_n?.toString() ?? '20'}
                  disabled={runMutation.isPending}
                />
              </div>
              <div className="form-field">
                <label>Language</label>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder={prefs?.default_language ?? ''}
                  disabled={runMutation.isPending}
                />
              </div>
              <div className="form-field">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeForks}
                    onChange={(e) => setIncludeForks(e.target.checked)}
                    disabled={runMutation.isPending}
                  />
                  <span>Include forks</span>
                </label>
              </div>
            </div>
          )}

          <div>
            <button
              className="btn-primary"
              onClick={handleStart}
              disabled={!query.trim() || !effectiveModel || runMutation.isPending}
            >
              {runMutation.isPending ? 'Running Discovery...' : 'Start Discovery'}
            </button>
          </div>
        </div>
      </div>

      {runMutation.isPending && (
        <div className="scout-loading">
          <div className="scout-spinner" />
          <p>Running discovery... this may take a minute or two.</p>
        </div>
      )}

      {runMutation.isError && (
        <div className="settings-group panel" style={{ marginTop: 'var(--space-4)' }}>
          <p style={{ color: 'var(--danger)', margin: '0 0 8px 0', fontWeight: 600 }}>
            Discovery failed: {(runMutation.error as Error).message}
          </p>
          {/unauthorized/i.test((runMutation.error as Error).message) && (
            <div className="settings-message settings-message--info" style={{ marginTop: 0 }}>
              <strong>Token invalid or revoked.</strong> Go to <strong>Settings → Scout Settings</strong>,
              check the token hint, and re-enter a valid token if needed.
            </div>
          )}
          {/not found|bad credentials/i.test((runMutation.error as Error).message) && (
            <div className="settings-message settings-message--info" style={{ marginTop: 0 }}>
              <strong>Token issue?</strong> "Not Found" or "Bad credentials" usually means:
              <ul style={{ paddingLeft: '20px', margin: '8px 0 0 0', lineHeight: '1.6' }}>
                <li>The token was revoked or expired — create a new one in Scout Settings.</li>
                <li>For private repos: ensure the token has the <code>repo</code> scope.</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
