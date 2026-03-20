import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface RssSettings {
  enabled: boolean;
  collect_time: string;
  articles_per_page: number;
  retention_days: number;
}

export function RssSettingsTab() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery<RssSettings>({
    queryKey: ['rss', 'settings'],
    queryFn: () => api.get('/rss/settings'),
  });

  const [saving, setSaving] = useState(false);
  const [collectMsg, setCollectMsg] = useState('');

  async function handlePatch(patch: Partial<RssSettings>) {
    setSaving(true);
    try {
      await api.patch('/rss/settings', patch);
      qc.invalidateQueries({ queryKey: ['rss', 'settings'] });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleCollectNow() {
    try {
      await api.post('/rss/collect');
      setCollectMsg('Collection job enqueued!');
      setTimeout(() => setCollectMsg(''), 3000);
    } catch {
      setCollectMsg('Failed to trigger collection');
    }
  }

  if (isLoading || !settings) {
    return <div className="rss-spinner">Loading settings…</div>;
  }

  return (
    <div className="rss-section">
      <h2 className="rss-section__title">RSS Settings</h2>

      <div className="rss-settings-group">
        <div className="rss-settings-group__title">General</div>

        <div className="rss-settings-row">
          <div>
            <div className="rss-settings-label">Enable RSS</div>
            <div className="rss-settings-desc">Collect articles from subscribed feeds</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => handlePatch({ enabled: e.target.checked })}
              disabled={saving}
            />
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {settings.enabled ? 'On' : 'Off'}
            </span>
          </label>
        </div>

        <div className="rss-settings-row">
          <div>
            <div className="rss-settings-label">Daily Collection Time</div>
            <div className="rss-settings-desc">When to automatically fetch new articles (local time, HH:MM)</div>
          </div>
          <input
            type="time"
            value={settings.collect_time}
            onChange={(e) => handlePatch({ collect_time: e.target.value })}
            disabled={saving}
            style={{ padding: '4px 8px', background: 'var(--bg-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-input)', color: 'var(--text-1)', fontSize: 12 }}
          />
        </div>

        <div className="rss-settings-row">
          <div>
            <div className="rss-settings-label">Articles Per Page</div>
            <div className="rss-settings-desc">How many articles to show per page in the viewer</div>
          </div>
          <select
            value={settings.articles_per_page}
            onChange={(e) => handlePatch({ articles_per_page: Number(e.target.value) })}
            disabled={saving}
            style={{ padding: '4px 8px', background: 'var(--bg-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-input)', color: 'var(--text-1)', fontSize: 12 }}
          >
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div className="rss-settings-row">
          <div>
            <div className="rss-settings-label">Article Retention</div>
            <div className="rss-settings-desc">How many days to keep articles before pruning</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={7}
              max={365}
              value={settings.retention_days}
              onChange={(e) => handlePatch({ retention_days: Number(e.target.value) })}
              disabled={saving}
              style={{ width: 64, padding: '4px 8px', background: 'var(--bg-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-input)', color: 'var(--text-1)', fontSize: 12 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>days</span>
          </div>
        </div>
      </div>

      <div className="rss-settings-group">
        <div className="rss-settings-group__title">Manual Controls</div>
        <div className="rss-settings-row" style={{ borderBottom: 'none' }}>
          <div>
            <div className="rss-settings-label">Collect Now</div>
            <div className="rss-settings-desc">Immediately fetch all enabled feeds</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {collectMsg && (
              <span style={{ fontSize: 12, color: 'var(--success)' }}>{collectMsg}</span>
            )}
            <button className="btn-secondary" onClick={handleCollectNow}>
              ⟳ Collect Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
