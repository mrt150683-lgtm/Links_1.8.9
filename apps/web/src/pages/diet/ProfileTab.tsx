import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface NutritionProfile {
  weight?: number;
  weight_unit?: 'kg' | 'lbs';
  height?: number;
  height_unit?: 'cm' | 'ft_in';
  height_ft?: number;
  height_in?: number;
  body_fat_pct?: number;
  dietary_goals?: string[];
  likes?: string;
  dislikes?: string;
  allergies?: string[];
  health_context?: string;
  units?: 'metric' | 'imperial';
  timezone?: string;
  preferred_checkin_day?: number;
  preferred_checkin_time?: string;
  explanation_style?: 'simple' | 'practical' | 'technical' | 'expert';
}

const GOAL_PRESETS = [
  'Lose weight', 'Maintain weight', 'Gain weight', 'Gain muscle',
  'Improve digestion', 'Improve energy', 'Improve sleep', 'Reduce cravings',
  'Symptom investigation', 'General healthy eating',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIMEZONES: { label: string; value: string }[] = [
  { label: 'England / London (UK)',              value: 'Europe/London' },
  { label: 'Ireland / Dublin',                   value: 'Europe/Dublin' },
  { label: 'Central Europe (Paris, Berlin, Rome)',value: 'Europe/Paris' },
  { label: 'Eastern Europe (Helsinki, Kyiv)',     value: 'Europe/Helsinki' },
  { label: 'Moscow',                             value: 'Europe/Moscow' },
  { label: 'Eastern Time (New York, Toronto)',   value: 'America/New_York' },
  { label: 'Central Time (Chicago, Dallas)',     value: 'America/Chicago' },
  { label: 'Mountain Time (Denver, Phoenix)',    value: 'America/Denver' },
  { label: 'Pacific Time (Los Angeles, Vancouver)', value: 'America/Los_Angeles' },
  { label: 'Alaska',                             value: 'America/Anchorage' },
  { label: 'Hawaii',                             value: 'Pacific/Honolulu' },
  { label: 'Atlantic Time (Halifax)',            value: 'America/Halifax' },
  { label: 'Brazil (São Paulo)',                 value: 'America/Sao_Paulo' },
  { label: 'Dubai / UAE',                        value: 'Asia/Dubai' },
  { label: 'India (IST)',                        value: 'Asia/Kolkata' },
  { label: 'Bangladesh / Dhaka',                 value: 'Asia/Dhaka' },
  { label: 'China / Singapore / Perth',          value: 'Asia/Shanghai' },
  { label: 'Japan / South Korea',                value: 'Asia/Tokyo' },
  { label: 'Australia East (Sydney, Melbourne)', value: 'Australia/Sydney' },
  { label: 'Australia Central (Adelaide)',       value: 'Australia/Adelaide' },
  { label: 'Australia West (Perth)',             value: 'Australia/Perth' },
  { label: 'New Zealand (Auckland)',             value: 'Pacific/Auckland' },
  { label: 'South Africa (SAST)',                value: 'Africa/Johannesburg' },
  { label: 'UTC (Coordinated Universal Time)',   value: 'UTC' },
];

export function ProfileTab() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [allergyInput, setAllergyInput] = useState('');
  const [goalInput, setGoalInput] = useState('');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['nutrition', 'profile'],
    queryFn: () => api.get<NutritionProfile>('/nutrition/profile'),
  });

  const [form, setForm] = useState<NutritionProfile>({});

  // Sync form from loaded profile
  const [initialized, setInitialized] = useState(false);
  if (profile && !initialized) {
    setForm(profile);
    setInitialized(true);
  }

  function update(patch: Partial<NutritionProfile>) {
    setForm((p) => ({ ...p, ...patch }));
  }

  function addAllergy() {
    const val = allergyInput.trim();
    if (!val) return;
    const existing = form.allergies ?? [];
    if (!existing.includes(val)) {
      update({ allergies: [...existing, val] });
    }
    setAllergyInput('');
  }

  function removeAllergy(a: string) {
    update({ allergies: (form.allergies ?? []).filter((x) => x !== a) });
  }

  function addGoal() {
    const val = goalInput.trim();
    if (!val) return;
    const existing = form.dietary_goals ?? [];
    if (!existing.includes(val)) {
      update({ dietary_goals: [...existing, val] });
    }
    setGoalInput('');
  }

  function removeGoal(g: string) {
    update({ dietary_goals: (form.dietary_goals ?? []).filter((x) => x !== g) });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.put('/nutrition/profile', form);
      qc.invalidateQueries({ queryKey: ['nutrition', 'profile'] });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <p className="tab-loading">Loading profile…</p>;

  return (
    <div className="profile-tab">
      <h2>Nutrition Profile</h2>
      <p className="profile-tab__desc">
        Your profile helps personalize meal analysis, reviews, and recipe suggestions.
      </p>

      <form onSubmit={handleSave} className="profile-form">
        <section className="profile-section">
          <h3>Body Metrics</h3>
          <div className="profile-row">
            <div className="form-row">
              <label className="form-label">Weight</label>
              <input
                className="form-input form-input--sm"
                type="number"
                step="0.1"
                placeholder="e.g. 75"
                value={form.weight ?? ''}
                onChange={(e) => update({ weight: Number(e.target.value) || undefined })}
              />
            </div>
            <div className="form-row">
              <label className="form-label">Unit</label>
              <select
                className="form-input form-input--sm"
                value={form.weight_unit ?? 'kg'}
                onChange={(e) => update({ weight_unit: e.target.value as any })}
              >
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Body Fat %</label>
              <input
                className="form-input form-input--sm"
                type="number"
                step="0.1"
                value={form.body_fat_pct ?? ''}
                onChange={(e) => update({ body_fat_pct: Number(e.target.value) || undefined })}
              />
            </div>
          </div>
        </section>

        <section className="profile-section">
          <h3>Dietary Goals</h3>
          <div className="goal-presets">
            {GOAL_PRESETS.map((preset) => {
              const active = (form.dietary_goals ?? []).includes(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  className={`goal-preset-btn ${active ? 'goal-preset-btn--active' : ''}`}
                  onClick={() => {
                    if (active) {
                      removeGoal(preset);
                    } else {
                      update({ dietary_goals: [...(form.dietary_goals ?? []), preset] });
                    }
                  }}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          <div className="chips-input" style={{ marginTop: 8 }}>
            {(form.dietary_goals ?? []).map((g) => (
              <span key={g} className="chip">
                {g}
                <button type="button" className="chip__remove" onClick={() => removeGoal(g)}>✕</button>
              </span>
            ))}
            <input
              className="chips-input__field"
              placeholder="Or type a custom goal…"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGoal())}
            />
            <button type="button" className="btn btn--sm" onClick={addGoal}>Add</button>
          </div>
        </section>

        <section className="profile-section">
          <h3>Allergies</h3>
          <div className="chips-input">
            {(form.allergies ?? []).map((a) => (
              <span key={a} className="chip chip--warning">
                {a}
                <button type="button" className="chip__remove" onClick={() => removeAllergy(a)}>✕</button>
              </span>
            ))}
            <input
              className="chips-input__field"
              placeholder="Add allergy (e.g. nuts, dairy, gluten)…"
              value={allergyInput}
              onChange={(e) => setAllergyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAllergy())}
            />
            <button type="button" className="btn btn--sm" onClick={addAllergy}>Add</button>
          </div>
          <p className="profile-section__note">
            Allergies are treated as hard constraints — the AI will always flag or exclude them.
          </p>
        </section>

        <section className="profile-section">
          <h3>Preferences</h3>
          <div className="form-row">
            <label className="form-label">Foods I like</label>
            <textarea
              className="form-input"
              rows={3}
              maxLength={10000}
              placeholder="Describe cuisines, ingredients, or dishes you enjoy…"
              value={form.likes ?? ''}
              onChange={(e) => update({ likes: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label className="form-label">Foods I dislike</label>
            <textarea
              className="form-input"
              rows={3}
              maxLength={10000}
              placeholder="Describe cuisines, ingredients, or dishes you dislike…"
              value={form.dislikes ?? ''}
              onChange={(e) => update({ dislikes: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label className="form-label">Health context (optional)</label>
            <textarea
              className="form-input"
              rows={2}
              maxLength={2000}
              placeholder="Any relevant health conditions or dietary requirements…"
              value={form.health_context ?? ''}
              onChange={(e) => update({ health_context: e.target.value })}
            />
          </div>
        </section>

        <section className="profile-section">
          <h3>Explanation Style</h3>
          <p className="profile-section__note">
            Controls how AI explanations and reviews are phrased for you.
          </p>
          <div className="form-row">
            <label className="form-label">Style</label>
            <select
              className="form-input"
              value={form.explanation_style ?? 'practical'}
              onChange={(e) => update({ explanation_style: e.target.value as any })}
            >
              <option value="simple">Simple — plain language, minimal jargon</option>
              <option value="practical">Practical — actionable, everyday focus (default)</option>
              <option value="technical">Technical — includes nutrient science and numbers</option>
              <option value="expert">Expert — clinical/research framing</option>
            </select>
          </div>
        </section>

        <section className="profile-section">
          <h3>Schedule</h3>
          <div className="profile-row">
            <div className="form-row">
              <label className="form-label">Timezone</label>
              <select
                className="form-input"
                value={form.timezone ?? ''}
                onChange={(e) => update({ timezone: e.target.value })}
              >
                <option value="">— select timezone —</option>
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label className="form-label">Weekly check-in day</label>
              <select
                className="form-input"
                value={form.preferred_checkin_day ?? 0}
                onChange={(e) => update({ preferred_checkin_day: Number(e.target.value) as any })}
              >
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          </div>
        </section>

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">Profile saved!</div>}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
