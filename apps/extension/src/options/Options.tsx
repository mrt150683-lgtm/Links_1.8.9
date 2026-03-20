import { useState, useEffect, useCallback } from 'react';
import { getSettings, saveSettings, clearToken } from '../shared/storage.js';
import { bootstrap, rotateToken, checkHealth, listPots } from '../shared/api.js';
import type { ExtSettings, Pot } from '../shared/types.js';
import './options.css';

type Tab = 'connection' | 'preferences' | 'about';

// ── Tab: Connection / Bootstrap Wizard ────────────────────────────────────────
function ConnectionTab({
  settings,
  onSettingsChange,
}: {
  settings: ExtSettings;
  onSettingsChange: (s: ExtSettings) => void;
}) {
  const [bootstrapInput, setBootstrapInput] = useState('');
  const [bootstrapState, setBootstrapState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [bootstrapError, setBootstrapError] = useState('');

  const [healthStatus, setHealthStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [rotateState, setRotateState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // Check health on mount if token exists
  useEffect(() => {
    if (settings.token) {
      void checkHealth(settings.endpoint).then((ok) =>
        setHealthStatus(ok ? 'ok' : 'error'),
      );
    }
  }, [settings.endpoint, settings.token]);

  async function handleBootstrap() {
    if (!bootstrapInput.trim()) return;
    setBootstrapState('loading');
    setBootstrapError('');

    const result = await bootstrap(settings.endpoint, bootstrapInput.trim());
    if (result.ok && result.token) {
      await saveSettings({ token: result.token });
      const updated = { ...settings, token: result.token };
      onSettingsChange(updated);
      setBootstrapState('success');
      setBootstrapInput('');
    } else {
      setBootstrapState('error');
      setBootstrapError('Bootstrap failed — check your token and ensure the API is running');
    }
  }

  async function handleRotate() {
    if (!settings.token) return;
    setRotateState('loading');
    const result = await rotateToken(settings.endpoint, settings.token);
    if (result.ok && result.token) {
      await saveSettings({ token: result.token });
      onSettingsChange({ ...settings, token: result.token });
      setRotateState('success');
      setTimeout(() => setRotateState('idle'), 2000);
    } else {
      setRotateState('error');
      setTimeout(() => setRotateState('idle'), 3000);
    }
  }

  async function handleDisconnect() {
    await clearToken();
    onSettingsChange({ ...settings, token: null, defaultPotId: null, defaultPotName: null });
    setHealthStatus('unknown');
    setBootstrapState('idle');
  }

  // Already connected
  if (settings.token) {
    return (
      <div className="opt-section">
        <h2 className="opt-section-title">Connection</h2>
        <p className="opt-desc">Connected to Links API</p>

        <div className="opt-info-row">
          <span className="opt-info-label">Endpoint</span>
          <span className="opt-info-value">{settings.endpoint}</span>
        </div>

        <div className="opt-info-row">
          <span className="opt-info-label">API Status</span>
          <span className={`opt-badge opt-badge--${healthStatus === 'ok' ? 'success' : healthStatus === 'error' ? 'danger' : 'neutral'}`}>
            {healthStatus === 'ok' ? '✓ Online' : healthStatus === 'error' ? '✗ Offline' : '— Checking…'}
          </span>
        </div>

        <div className="opt-actions">
          <button
            className="btn-secondary"
            onClick={() => void handleRotate()}
            disabled={rotateState === 'loading'}
          >
            {rotateState === 'loading' ? 'Rotating…' : rotateState === 'success' ? '✓ Rotated' : rotateState === 'error' ? '✗ Failed' : 'Rotate Token'}
          </button>
          <button className="btn-ghost opt-danger-btn" onClick={() => void handleDisconnect()}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // Bootstrap wizard
  return (
    <div className="opt-section">
      <h2 className="opt-section-title">Welcome to Links Extension</h2>
      <p className="opt-desc">
        Paste your <code className="opt-code">EXT_BOOTSTRAP_TOKEN</code> from your{' '}
        <code className="opt-code">.env</code> file to connect.
      </p>

      {bootstrapState === 'success' ? (
        <div className="opt-success-box">
          <div className="opt-success-icon">✓</div>
          <div>
            <div className="opt-success-title">Connected to Links API</div>
            <div className="opt-success-sub">Token stored securely. Go to Preferences to select your default pot.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="opt-field">
            <label className="opt-field-label" htmlFor="bootstrap-token">
              Bootstrap Token
            </label>
            <input
              id="bootstrap-token"
              type="password"
              className="opt-input"
              placeholder="Paste your EXT_BOOTSTRAP_TOKEN…"
              value={bootstrapInput}
              onChange={(e) => setBootstrapInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleBootstrap()}
              disabled={bootstrapState === 'loading'}
              autoComplete="off"
            />
          </div>

          {bootstrapState === 'error' && (
            <div className="opt-error-box">✗ {bootstrapError}</div>
          )}

          <button
            className="btn-primary opt-connect-btn"
            onClick={() => void handleBootstrap()}
            disabled={bootstrapState === 'loading' || !bootstrapInput.trim()}
          >
            {bootstrapState === 'loading' ? 'Connecting…' : 'Connect to Links'}
          </button>
        </>
      )}
    </div>
  );
}

// ── Tab: Preferences ──────────────────────────────────────────────────────────
function PreferencesTab({
  settings,
  onSettingsChange,
}: {
  settings: ExtSettings;
  onSettingsChange: (s: ExtSettings) => void;
}) {
  const [pots, setPots] = useState<Pot[]>([]);
  const [loadingPots, setLoadingPots] = useState(false);
  const [endpointInput, setEndpointInput] = useState(settings.endpoint);
  const [appUrlInput, setAppUrlInput] = useState(settings.appUrl);
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.token) return;
    setLoadingPots(true);
    listPots(settings.endpoint, settings.token)
      .then(setPots)
      .catch(() => setPots([]))
      .finally(() => setLoadingPots(false));
  }, [settings.endpoint, settings.token]);

  async function handlePotChange(potId: string) {
    const pot = pots.find((p) => p.id === potId);
    if (!pot) return;
    await saveSettings({ defaultPotId: pot.id, defaultPotName: pot.name });
    onSettingsChange({ ...settings, defaultPotId: pot.id, defaultPotName: pot.name });
  }

  async function handleEndpointSave() {
    const trimmed = endpointInput.trim().replace(/\/$/, '');
    await saveSettings({ endpoint: trimmed });
    onSettingsChange({ ...settings, endpoint: trimmed });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleAppUrlSave() {
    const trimmed = appUrlInput.trim().replace(/\/$/, '');
    await saveSettings({ appUrl: trimmed });
    onSettingsChange({ ...settings, appUrl: trimmed });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestConnection() {
    setTestState('loading');
    const ok = await checkHealth(endpointInput.trim());
    setTestState(ok ? 'ok' : 'fail');
    setTimeout(() => setTestState('idle'), 3000);
  }

  return (
    <div className="opt-section">
      <h2 className="opt-section-title">Preferences</h2>

      {/* Default pot */}
      <div className="opt-field">
        <label className="opt-field-label" htmlFor="pref-pot">
          Default Research Pot
        </label>
        {!settings.token ? (
          <p className="opt-hint">Connect to the API first to select a pot.</p>
        ) : (
          <select
            id="pref-pot"
            className="opt-select"
            value={settings.defaultPotId ?? ''}
            onChange={(e) => void handlePotChange(e.target.value)}
            disabled={loadingPots || pots.length === 0}
          >
            {loadingPots && <option value="">Loading pots…</option>}
            {!loadingPots && pots.length === 0 && <option value="">No pots available</option>}
            {!loadingPots && pots.length > 0 && (
              <>
                {!settings.defaultPotId && <option value="">— Select a pot —</option>}
                {pots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </>
            )}
          </select>
        )}
      </div>

      {/* Endpoint override */}
      <div className="opt-field">
        <label className="opt-field-label" htmlFor="pref-endpoint">
          API Endpoint
        </label>
        <input
          id="pref-endpoint"
          type="url"
          className="opt-input"
          value={endpointInput}
          onChange={(e) => setEndpointInput(e.target.value)}
        />
        <p className="opt-hint">Default: http://127.0.0.1:3000</p>
      </div>

      {/* App URL */}
      <div className="opt-field">
        <label className="opt-field-label" htmlFor="pref-app-url">
          Links App URL
        </label>
        <input
          id="pref-app-url"
          type="url"
          className="opt-input"
          value={appUrlInput}
          onChange={(e) => setAppUrlInput(e.target.value)}
        />
        <p className="opt-hint">Default: http://localhost:3001</p>
      </div>

      <div className="opt-actions">
        <button
          className="btn-secondary"
          onClick={() => void handleTestConnection()}
          disabled={testState === 'loading'}
        >
          {testState === 'loading' ? 'Testing…' : testState === 'ok' ? '✓ Online' : testState === 'fail' ? '✗ Offline' : 'Test Connection'}
        </button>
        <button
          className="btn-primary"
          onClick={() => void handleEndpointSave()}
        >
          {saved ? '✓ Saved' : 'Save Endpoint'}
        </button>
        <button
          className="btn-primary"
          onClick={() => void handleAppUrlSave()}
        >
          {saved ? '✓ Saved' : 'Save App URL'}
        </button>
      </div>
    </div>
  );
}

// ── Tab: About ────────────────────────────────────────────────────────────────
function AboutTab() {
  return (
    <div className="opt-section">
      <h2 className="opt-section-title">About</h2>
      <div className="opt-about-list">
        <div className="opt-info-row">
          <span className="opt-info-label">Version</span>
          <span className="opt-info-value">1.0.0</span>
        </div>
        <div className="opt-info-row">
          <span className="opt-info-label">Web App</span>
          <span className="opt-info-value">
            <a href="http://127.0.0.1:5173" target="_blank" rel="noreferrer">
              http://127.0.0.1:5173
            </a>
          </span>
        </div>
      </div>

      <h3 className="opt-sub-title">Loading the Extension</h3>
      <ol className="opt-steps">
        <li>Build the extension: <code className="opt-code">pnpm build</code> in <code className="opt-code">apps/extension</code></li>
        <li>Open Chrome → <code className="opt-code">chrome://extensions</code></li>
        <li>Enable <strong>Developer mode</strong> (top right toggle)</li>
        <li>Click <strong>Load unpacked</strong> → select the <code className="opt-code">dist/</code> folder</li>
        <li>Pin the extension icon from the toolbar</li>
      </ol>

      <h3 className="opt-sub-title">First-Time Setup</h3>
      <ol className="opt-steps">
        <li>Add <code className="opt-code">EXT_BOOTSTRAP_TOKEN=yourtoken</code> to <code className="opt-code">.env</code></li>
        <li>Restart the Links API</li>
        <li>Open this Options page → paste your token → click Connect</li>
        <li>Select your default research pot in Preferences</li>
      </ol>
    </div>
  );
}

// ── Root Options component ────────────────────────────────────────────────────
export default function Options() {
  const [activeTab, setActiveTab] = useState<Tab>('connection');
  const [settings, setSettings] = useState<ExtSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    // If already connected, go to preferences tab
    if (s.token) setActiveTab('preferences');
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (loading || !settings) {
    return (
      <div className="opt-root">
        <div className="opt-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="opt-root">
      {/* Header */}
      <header className="opt-header">
        <div className="opt-brand">
          <span className="opt-brand-icon">⬡</span>
          <span className="opt-brand-name">Links</span>
          <span className="opt-brand-sub">Extension Settings</span>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="opt-tabs">
        {(['connection', 'preferences', 'about'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`opt-tab ${activeTab === tab ? 'opt-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="opt-content">
        {activeTab === 'connection' && (
          <ConnectionTab settings={settings} onSettingsChange={setSettings} />
        )}
        {activeTab === 'preferences' && (
          <PreferencesTab settings={settings} onSettingsChange={setSettings} />
        )}
        {activeTab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}
