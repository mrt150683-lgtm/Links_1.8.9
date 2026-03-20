import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface WellbeingLog {
  id: string;
  log_date: string;
  symptoms: string[];
  mood: number | null;
  energy: number | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  anxiety: number | null;
  notes: string | null;
}

const SYMPTOM_CODES = [
  'felt_good', 'felt_off',
  'bloating', 'stomach_pain', 'nausea', 'constipation', 'digestion_issues',
  'headache', 'fatigue', 'brain_fog', 'grogginess',
  'mood_low', 'anxiety_high', 'craving_sugar', 'craving_salt',
  'vivid_dreams',
] as const;

const SYMPTOM_LABELS: Record<string, string> = {
  felt_good: 'Felt good', felt_off: 'Felt off',
  bloating: 'Bloating', stomach_pain: 'Stomach pain', nausea: 'Nausea',
  constipation: 'Constipation', digestion_issues: 'Digestion issues',
  headache: 'Headache', fatigue: 'Fatigue', brain_fog: 'Brain fog',
  grogginess: 'Grogginess', mood_low: 'Low mood', anxiety_high: 'High anxiety',
  craving_sugar: 'Sugar craving', craving_salt: 'Salt craving', vivid_dreams: 'Vivid dreams',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function WellbeingTab({ potId: _potId }: { potId: string }) {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [form, setForm] = useState<Partial<WellbeingLog>>({ symptoms: [] });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: currentLog } = useQuery({
    queryKey: ['nutrition', 'wellbeing', selectedDate],
    queryFn: () => api.get<WellbeingLog>(`/nutrition/wellbeing?date=${selectedDate}`).catch(() => null),
  });

  const { data: rangeData } = useQuery({
    queryKey: ['nutrition', 'wellbeing', 'range', '14d'],
    queryFn: () => {
      const to = todayKey();
      const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
      return api.get<{ logs: WellbeingLog[] }>(`/nutrition/wellbeing/range?from=${from}&to=${to}`);
    },
    staleTime: 60_000,
  });

  // Sync form from loaded log for selected date
  const [lastLoadedDate, setLastLoadedDate] = useState('');
  if (currentLog && selectedDate !== lastLoadedDate) {
    setForm({
      symptoms: currentLog.symptoms ?? [],
      mood: currentLog.mood,
      energy: currentLog.energy,
      sleep_quality: currentLog.sleep_quality,
      sleep_hours: currentLog.sleep_hours,
      anxiety: currentLog.anxiety,
      notes: currentLog.notes,
    });
    setLastLoadedDate(selectedDate);
  } else if (!currentLog && selectedDate !== lastLoadedDate) {
    setForm({ symptoms: [] });
    setLastLoadedDate(selectedDate);
  }

  function update(patch: Partial<WellbeingLog>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function toggleSymptom(code: string) {
    const symptoms = form.symptoms ?? [];
    update({ symptoms: symptoms.includes(code) ? symptoms.filter((s) => s !== code) : [...symptoms, code] });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post('/nutrition/wellbeing', { log_date: selectedDate, ...form });
      qc.invalidateQueries({ queryKey: ['nutrition', 'wellbeing', selectedDate] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'wellbeing', 'range', '14d'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const recentLogs = rangeData?.logs ?? [];

  return (
    <div className="wellbeing-tab">
      <h2>Wellbeing Log</h2>
      <p className="tab-desc">Track how you feel each day to help identify patterns over time.</p>

      <div className="form-row">
        <label className="form-label">Date</label>
        <input
          className="form-input form-input--sm"
          type="date"
          value={selectedDate}
          max={todayKey()}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      <form onSubmit={handleSave} className="wellbeing-form wellbeing-form--standalone">
        <section className="wellbeing-section">
          <h3>How are you feeling?</h3>
          {(['mood', 'energy', 'sleep_quality', 'anxiety'] as const).map((field) => {
            const labels: Record<string, string> = {
              mood: 'Mood', energy: 'Energy', sleep_quality: 'Sleep Quality', anxiety: 'Anxiety',
            };
            return (
              <div key={field} className="wellbeing-score-row">
                <span className="wellbeing-score-label">{labels[field]}</span>
                <div className="dot-scale">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`dot-btn ${(form[field] ?? 0) >= n ? 'dot-btn--active' : ''}`}
                      onClick={() => update({ [field]: n })}
                    >
                      ●
                    </button>
                  ))}
                  <span className="dot-value">{form[field] ?? '—'}/5</span>
                </div>
              </div>
            );
          })}
          <div className="wellbeing-score-row">
            <span className="wellbeing-score-label">Sleep hours</span>
            <input
              className="form-input form-input--sm"
              type="number"
              step="0.5"
              min="0"
              max="24"
              placeholder="e.g. 7.5"
              value={form.sleep_hours ?? ''}
              onChange={(e) => update({ sleep_hours: Number(e.target.value) || undefined })}
            />
          </div>
        </section>

        <section className="wellbeing-section">
          <h3>Symptoms</h3>
          <div className="symptom-chips__grid">
            {SYMPTOM_CODES.map((code) => (
              <button
                key={code}
                type="button"
                className={`symptom-chip ${(form.symptoms ?? []).includes(code) ? 'symptom-chip--active' : ''}`}
                onClick={() => toggleSymptom(code)}
              >
                {SYMPTOM_LABELS[code]}
              </button>
            ))}
          </div>
        </section>

        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea
            className="form-input"
            rows={3}
            maxLength={2000}
            placeholder="Additional notes…"
            value={form.notes ?? ''}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </div>

        {error && <div className="form-error">{error}</div>}
        {saved && <div className="form-success">Saved!</div>}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Log'}
          </button>
        </div>
      </form>

      {/* Recent logs summary */}
      {recentLogs.length > 0 && (
        <div className="wellbeing-history">
          <h3>Recent Log (last 14 days)</h3>
          <div className="wellbeing-history__list">
            {recentLogs.map((log) => (
              <div
                key={log.id}
                className={`wellbeing-history__row ${log.log_date === selectedDate ? 'wellbeing-history__row--selected' : ''}`}
                onClick={() => setSelectedDate(log.log_date)}
                style={{ cursor: 'pointer' }}
              >
                <span className="wellbeing-history__date">{log.log_date}</span>
                {log.mood != null && <span className="wellbeing-history__score">M:{log.mood}</span>}
                {log.energy != null && <span className="wellbeing-history__score">E:{log.energy}</span>}
                {log.sleep_quality != null && <span className="wellbeing-history__score">S:{log.sleep_quality}</span>}
                {log.symptoms?.length > 0 && (
                  <div className="wellbeing-history__symptoms">
                    {log.symptoms.slice(0, 4).map((s) => (
                      <span key={s} className="symptom-chip symptom-chip--sm symptom-chip--active">
                        {SYMPTOM_LABELS[s] ?? s}
                      </span>
                    ))}
                    {log.symptoms.length > 4 && <span className="symptom-chip symptom-chip--sm">+{log.symptoms.length - 4}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
