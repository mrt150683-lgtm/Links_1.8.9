import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScoutPreferences } from '@/lib/types';

interface TokenCheckResult {
  source: 'scout_settings' | 'env_GITHUB_TOKEN' | 'none';
  token_hint: string | null;
  github_status: string;
  scopes: string[] | null;       // null = fine-grained token (no x-oauth-scopes header)
  has_repo_scope: boolean | null; // null = unknown (fine-grained token)
}

interface ModelInfo {
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
}

export function ScoutSettings() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ['scout-prefs'],
    queryFn: () => api.get<ScoutPreferences>('/prefs/scout'),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<ModelsResponse>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const saveMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.put<ScoutPreferences>('/prefs/scout', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scout-prefs'] });
    },
  });

  // ── Token state ─────────────────────────────────────────────────────
  const [tokenDraft, setTokenDraft] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenCheck, setTokenCheck] = useState<TokenCheckResult | null>(null);
  const [tokenChecking, setTokenChecking] = useState(false);

  const handleTestToken = async () => {
    setTokenChecking(true);
    setTokenCheck(null);
    try {
      const result = await api.get<TokenCheckResult>('/scout/check-token');
      setTokenCheck(result);
    } catch {
      setTokenCheck({ source: 'none', token_hint: null, github_status: 'api_error', scopes: null, has_repo_scope: null });
    } finally {
      setTokenChecking(false);
    }
  };

  const handleSaveToken = () => {
    saveMutation.mutate({ github_token: tokenDraft }, {
      onSuccess: () => {
        setTokenDraft('');
        setTokenSaved(true);
        setTimeout(() => setTokenSaved(false), 3000);
      },
    });
  };

  const handleClearToken = () => {
    saveMutation.mutate({ github_token: '' });
    setTokenDraft('');
  };

  // ── Default search params state (local drafts, save on blur) ──────
  const [daysDraft, setDaysDraft] = useState('');
  const [starsDraft, setStarsDraft] = useState('');
  const [maxStarsDraft, setMaxStarsDraft] = useState('');
  const [topNDraft, setTopNDraft] = useState('');
  const [langDraft, setLangDraft] = useState('');
  const [forksDraft, setForksDraft] = useState(false);
  const [searchInitialized, setSearchInitialized] = useState(false);

  useEffect(() => {
    if (prefs && !searchInitialized) {
      setDaysDraft(prefs.default_days?.toString() ?? '');
      setStarsDraft(prefs.default_stars?.toString() ?? '');
      setMaxStarsDraft(prefs.default_max_stars?.toString() ?? '');
      setTopNDraft(prefs.default_top_n?.toString() ?? '');
      setLangDraft(prefs.default_language ?? '');
      setForksDraft(prefs.default_include_forks ?? false);
      setSearchInitialized(true);
    }
  }, [prefs, searchInitialized]);

  const saveSearchParam = (key: string, value: unknown) => {
    saveMutation.mutate({ [key]: value });
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Scout Settings</h2>
        <p className="text-muted">
          Configure GitHub access and default search parameters for Scout discovery runs.
        </p>
      </div>

      {/* ── GitHub Token ─────────────────────────────────────────────── */}
      <div className="settings-group panel">
        <h3 className="settings-group__title">GitHub Token</h3>

        {prefs?.github_token_set && (
          <p className="text-muted" style={{ fontSize: '13px' }}>
            Token configured: <code>{prefs.github_token_hint}</code>
          </p>
        )}

        <div className="form-field">
          <label>Personal Access Token (Classic)</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder={prefs?.github_token_set ? 'Enter new token to replace' : 'ghp_...'}
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
            <button
              className="btn-secondary"
              onClick={() => setShowToken(!showToken)}
              style={{ minWidth: '60px' }}
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn-primary"
            onClick={handleSaveToken}
            disabled={!tokenDraft || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Token'}
          </button>
          {prefs?.github_token_set && (
            <button className="btn-secondary" onClick={handleClearToken}>
              Clear Token
            </button>
          )}
        </div>

        {tokenSaved && (
          <p style={{ color: 'var(--success)', fontSize: '13px' }}>Token saved.</p>
        )}

        <div style={{ marginTop: '8px' }}>
          <button
            className="btn-secondary"
            onClick={handleTestToken}
            disabled={tokenChecking}
          >
            {tokenChecking ? 'Testing...' : 'Test Token'}
          </button>

          {tokenCheck && (
            <div style={{ marginTop: '8px', fontSize: '13px', fontFamily: 'monospace', background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '4px', lineHeight: '1.7' }}>
              <div>source: <strong>{tokenCheck.source}</strong></div>
              <div>token:  <strong>{tokenCheck.token_hint ?? '(none)'}</strong></div>
              <div style={{ color: tokenCheck.github_status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
                github: <strong>{tokenCheck.github_status}</strong>
              </div>
              {tokenCheck.scopes !== null && (
                <div style={{ color: tokenCheck.has_repo_scope ? 'var(--success)' : 'var(--danger)' }}>
                  scopes: <strong>{tokenCheck.scopes.length > 0 ? tokenCheck.scopes.join(', ') : '(none)'}</strong>
                  {!tokenCheck.has_repo_scope && ' ← needs "repo" for private repos'}
                </div>
              )}
              {tokenCheck.scopes === null && tokenCheck.github_status === 'ok' && (
                <div style={{ color: 'var(--text-1)', fontFamily: 'sans-serif', fontSize: '12px', marginTop: '4px' }}>
                  Fine-grained token detected — scope check not available. Private repo access depends on the permissions you granted.
                </div>
              )}
              {tokenCheck.source === 'env_GITHUB_TOKEN' && (
                <div style={{ marginTop: '6px', color: 'var(--danger)', fontFamily: 'sans-serif', fontSize: '12px' }}>
                  Warning: app is using GITHUB_TOKEN from environment, not Scout Settings. Clear it from your Links .env file.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="settings-message settings-message--info" style={{ marginTop: '8px' }}>
          <strong>Token Scopes:</strong>
          <ul style={{ paddingLeft: '20px', margin: '8px 0 0 0', lineHeight: '1.6' }}>
            <li><strong>No scopes</strong> = public repo search only</li>
            <li><code>public_repo</code> = public repository metadata access</li>
            <li><code>repo</code> = public + private repository access</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            Create a token at{' '}
            <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-1)' }}>
              github.com/settings/tokens
            </a>
          </p>
        </div>
      </div>

      {/* ── Default Model ─────────────────────────────────────────── */}
      <div className="settings-group panel">
        <h3 className="settings-group__title">Default Model</h3>
        <p className="text-muted">AI model used for Scout analysis and brief generation.</p>

        <div className="form-field">
          <select
            value={prefs?.default_model ?? ''}
            onChange={(e) => saveSearchParam('default_model', e.target.value || undefined)}
            disabled={models.length === 0}
          >
            <option value="">Auto-select (default)</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {models.length === 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              No models loaded. Go to Settings &rarr; AI Provider &rarr; Refresh Models first.
            </p>
          )}
        </div>
      </div>

      {/* ── Default Search Parameters ──────────────────────────────── */}
      <div className="settings-group panel">
        <h3 className="settings-group__title">Default Search Parameters</h3>
        <p className="text-muted">Pre-fill these values when starting a new discovery run.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-field">
            <label>Days (look-back window)</label>
            <input
              type="number"
              min="1"
              value={daysDraft}
              onChange={(e) => setDaysDraft(e.target.value)}
              onBlur={() => saveSearchParam('default_days', daysDraft ? parseInt(daysDraft) : undefined)}
              placeholder="30"
            />
          </div>

          <div className="form-field">
            <label>Min Stars</label>
            <input
              type="number"
              min="0"
              value={starsDraft}
              onChange={(e) => setStarsDraft(e.target.value)}
              onBlur={() => saveSearchParam('default_stars', starsDraft ? parseInt(starsDraft) : undefined)}
              placeholder="10"
            />
          </div>

          <div className="form-field">
            <label>Max Stars</label>
            <input
              type="number"
              min="0"
              value={maxStarsDraft}
              onChange={(e) => setMaxStarsDraft(e.target.value)}
              onBlur={() => saveSearchParam('default_max_stars', maxStarsDraft ? parseInt(maxStarsDraft) : undefined)}
              placeholder="10000"
            />
          </div>

          <div className="form-field">
            <label>Top N results</label>
            <input
              type="number"
              min="1"
              value={topNDraft}
              onChange={(e) => setTopNDraft(e.target.value)}
              onBlur={() => saveSearchParam('default_top_n', topNDraft ? parseInt(topNDraft) : undefined)}
              placeholder="20"
            />
          </div>
        </div>

        <div className="form-field">
          <label>Language</label>
          <input
            type="text"
            value={langDraft}
            onChange={(e) => setLangDraft(e.target.value)}
            onBlur={() => saveSearchParam('default_language', langDraft || undefined)}
            placeholder="e.g. TypeScript, Python, Rust"
          />
        </div>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={forksDraft}
              onChange={(e) => {
                setForksDraft(e.target.checked);
                saveSearchParam('default_include_forks', e.target.checked);
              }}
            />
            <span>Include forked repositories</span>
          </label>
        </div>
      </div>

      {saveMutation.isError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px' }}>
          Failed to save — check the API connection.
        </p>
      )}
    </div>
  );
}
