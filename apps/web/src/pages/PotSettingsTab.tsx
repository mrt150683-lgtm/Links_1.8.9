/**
 * PotSettingsTab — edit goal, role, search engines, and DYK interval for a pot
 */

import { useState, useEffect } from 'react';
import { AgentSettingsPanel } from '@/features/agent/AgentSettingsPanel';
import './PotSettingsTab.css';

const API_BASE = '/api';

const PREDEFINED_ROLES = [
  { value: '', label: 'Default (general research)' },
  { value: 'builtin:forensic_analyst', label: 'Forensic Analyst' },
  { value: 'builtin:research_assistant', label: 'Research Assistant' },
];

const FALLBACK_TARGETS = [
  { id: 'google', label: 'Google' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
  { id: 'bing', label: 'Bing' },
  { id: 'github', label: 'GitHub' },
  { id: 'stackoverflow', label: 'Stack Overflow' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'pubmed', label: 'PubMed' },
  { id: 'wikipedia', label: 'Wikipedia' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'reddit', label: 'Reddit' },
];

interface PotSettingsTabProps {
  potId: string;
}

export function PotSettingsTab({ potId }: PotSettingsTabProps) {
  const [goalText, setGoalText] = useState('');
  const [roleRef, setRoleRef] = useState('');
  const [searchTargets, setSearchTargets] = useState<string[]>([]);
  const [dykIntervalHours, setDykIntervalHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/pots/${potId}/onboarding`);
        if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
        const data = await res.json();
        setGoalText(data.goal_text ?? '');
        setRoleRef(data.role_ref ?? '');
        setSearchTargets(data.search_targets ?? []);
        setDykIntervalHours(data.dyk_interval_hours ?? 24);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [potId]);

  function toggleTarget(id: string) {
    setSearchTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE}/pots/${potId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_text: goalText || null,
          role_ref: roleRef || null,
          search_targets: searchTargets,
          dyk_interval_hours: dykIntervalHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Server error ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="pot-settings-tab pot-settings-tab--loading">Loading settings…</div>;
  }

  return (
    <div className="pot-settings-tab">
      <h2 className="pot-settings-tab__title">Pot Settings</h2>

      {/* Research Goal */}
      <section className="pot-settings-tab__section">
        <label className="pot-settings-tab__label">Research Goal</label>
        <p className="pot-settings-tab__hint">
          Describe what you're trying to learn or investigate. This is injected into chat to focus the AI.
        </p>
        <textarea
          className="pot-settings-tab__textarea"
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder="e.g. Investigate AI safety research trends in 2024…"
          rows={3}
        />
      </section>

      {/* Agent Role */}
      <section className="pot-settings-tab__section">
        <label className="pot-settings-tab__label">Agent Role</label>
        <p className="pot-settings-tab__hint">
          Choose how the AI approaches your research.
        </p>
        <div className="pot-settings-tab__role-buttons">
          {PREDEFINED_ROLES.map((r) => (
            <button
              key={r.value || 'default'}
              className={`pot-settings-tab__role-btn ${roleRef === r.value ? 'pot-settings-tab__role-btn--selected' : ''}`}
              onClick={() => setRoleRef(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>

      {/* Search Engines */}
      <section className="pot-settings-tab__section">
        <label className="pot-settings-tab__label">Search Engines</label>
        <p className="pot-settings-tab__hint">
          Which search engines should the Search action use for this pot?
        </p>
        <div className="pot-settings-tab__targets">
          {FALLBACK_TARGETS.map((t) => (
            <button
              key={t.id}
              className={`pot-settings-tab__target ${searchTargets.includes(t.id) ? 'pot-settings-tab__target--selected' : ''}`}
              onClick={() => toggleTarget(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* DYK Interval */}
      <section className="pot-settings-tab__section">
        <label className="pot-settings-tab__label">Insight Frequency (hours)</label>
        <p className="pot-settings-tab__hint">
          How often (in hours) should the system generate new "Did You Know" insights for this pot?
        </p>
        <input
          className="pot-settings-tab__number"
          type="number"
          min={1}
          max={168}
          value={dykIntervalHours}
          onChange={(e) => setDykIntervalHours(Math.max(1, parseInt(e.target.value, 10) || 24))}
        />
      </section>

      {/* Agent Settings */}
      <AgentSettingsPanel potId={potId} />

      {/* Automation & Heartbeat — managed in Automation tab */}
      <div className="agent-settings-panel">
        <div className="agent-settings-panel__heading">Automation & Heartbeat</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Automation and heartbeat settings are in the{' '}
          <strong>Automation → Settings</strong> tab.
        </p>
      </div>

      {error && <div className="pot-settings-tab__error">{error}</div>}

      <div className="pot-settings-tab__footer">
        <button
          className="pot-settings-tab__save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
