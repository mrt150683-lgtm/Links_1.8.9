import { useState, useEffect, useCallback } from 'react';
import { getSettings, saveSettings, getLastStatus } from '../shared/storage.js';
import { listPots } from '../shared/api.js';
import type { ExtSettings, CaptureStatus, Pot } from '../shared/types.js';
import './popup.css';

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export default function Popup() {
  const [settings, setSettings] = useState<ExtSettings | null>(null);
  const [pots, setPots] = useState<Pot[]>([]);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, lastStatus] = await Promise.all([getSettings(), getLastStatus()]);
      setSettings(s);
      setStatus(lastStatus);

      if (s.token) {
        try {
          const potsData = await listPots(s.endpoint, s.token);
          setPots(potsData);
          setApiReachable(true);
        } catch (err) {
          setApiReachable(false);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    // Listen for status updates from background
    const listener = (message: { type: string; status?: CaptureStatus }) => {
      if (message.type === 'SET_STATUS' && message.status) {
        setStatus(message.status);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadData]);

  async function handlePotChange(potId: string) {
    const pot = pots.find((p) => p.id === potId);
    if (!pot) return;
    await saveSettings({ defaultPotId: pot.id, defaultPotName: pot.name });
    setSettings((prev) => prev ? { ...prev, defaultPotId: pot.id, defaultPotName: pot.name } : prev);
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  function openApp() {
    void chrome.tabs.create({ url: settings.appUrl });
  }

  if (loading) {
    return (
      <div className="popup-container">
        <div className="popup-loading">Loading…</div>
      </div>
    );
  }

  const hasToken = !!settings?.token;

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <div className="popup-brand">
          <span className="popup-brand-icon">⬡</span>
          <span className="popup-brand-name">Links</span>
        </div>
        <button className="popup-gear" onClick={openOptions} title="Settings" aria-label="Open settings">
          ⚙
        </button>
      </div>

      {/* No token warning */}
      {!hasToken && (
        <div className="popup-banner popup-banner--warn">
          Setup required —{' '}
          <button className="popup-banner-link" onClick={openOptions}>
            open Options
          </button>
        </div>
      )}

      {/* API offline warning */}
      {hasToken && apiReachable === false && (
        <div className="popup-banner popup-banner--error">
          <span>Links API offline</span>
          <span className="popup-banner-hint">Is the API running?</span>
        </div>
      )}

      {/* Pot selector */}
      {hasToken && (
        <div className="popup-section">
          <label className="popup-label" htmlFor="pot-select">
            Research Pot
          </label>
          <select
            id="pot-select"
            className="popup-select"
            value={settings.defaultPotId ?? ''}
            onChange={(e) => void handlePotChange(e.target.value)}
            disabled={pots.length === 0}
          >
            {pots.length === 0 ? (
              <option value="">No pots available</option>
            ) : (
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
        </div>
      )}

      {/* Last status */}
      {status && status.type !== 'idle' && (
        <div className={`popup-status popup-status--${status.type}`}>
          <span className="popup-status-icon">
            {status.type === 'success' ? '✓' : status.type === 'error' ? '✗' : '…'}
          </span>
          <span className="popup-status-text">
            {status.message}
            {status.type === 'success' && (
              <span className="popup-status-time"> · {timeAgo(status.timestamp)}</span>
            )}
          </span>
        </div>
      )}

      {/* Open app button */}
      <div className="popup-footer">
        <button className="btn-primary popup-open-btn" onClick={openApp}>
          Open Links App
        </button>
      </div>
    </div>
  );
}
