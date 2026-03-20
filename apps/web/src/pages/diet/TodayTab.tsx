import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MealUploadModal } from './MealUploadModal';
import { MealCorrectionPanel } from './MealCorrectionPanel';

interface NutritionMeal {
  id: string;
  pot_id: string;
  meal_date: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  asset_id: string | null;
  user_note: string | null;
  user_correction: Record<string, unknown> | null;
  analysis_json: Record<string, unknown> | null;
  error_message: string | null;
  accepted: boolean;
  created_at: number;
  updated_at: number;
}

interface WellbeingLog {
  id?: string;
  symptoms: string[];
  mood: number | null;
  energy: number | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  anxiety: number | null;
  notes: string | null;
}

interface Supplement {
  id: string;
  name: string;
  default_dose: number | null;
  dose_unit: string | null;
}

interface SupplementEntry {
  id: string;
  supplement_id: string;
  dose: number | null;
  dose_unit: string | null;
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
  felt_good: 'Felt good',
  felt_off: 'Felt off',
  bloating: 'Bloating',
  stomach_pain: 'Stomach pain',
  nausea: 'Nausea',
  constipation: 'Constipation',
  digestion_issues: 'Digestion issues',
  headache: 'Headache',
  fatigue: 'Fatigue',
  brain_fog: 'Brain fog',
  grogginess: 'Grogginess',
  mood_low: 'Low mood',
  anxiety_high: 'High anxiety',
  craving_sugar: 'Sugar craving',
  craving_salt: 'Salt craving',
  vivid_dreams: 'Vivid dreams',
};

const MEAL_TYPES: Array<'breakfast' | 'lunch' | 'dinner' | 'snack'> = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
];

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCalories(meal: NutritionMeal): number | null {
  const data = meal.user_correction ?? meal.analysis_json;
  if (!data) return null;
  const totals = (data as any).totals;
  return totals?.calories ?? null;
}

function getConfidence(meal: NutritionMeal): string | null {
  const data = meal.analysis_json;
  if (!data) return null;
  return (data as any).portion_confidence ?? null;
}

export function TodayTab({ potId: _potId }: { potId: string }) {
  const today = todayKey();
  const qc = useQueryClient();
  const [uploadFor, setUploadFor] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack' | null>(null);
  const [correcting, setCorrecting] = useState<NutritionMeal | null>(null);
  const [wellbeingOpen, setWellbeingOpen] = useState(false);
  const [supplementsOpen, setSupplementsOpen] = useState(false);
  const [wellbeingForm, setWellbeingForm] = useState<Partial<WellbeingLog>>({ symptoms: [] });
  const [selectedSuppId, setSelectedSuppId] = useState('');
  const [suppDose, setSuppDose] = useState('');
  const [addSuppOpen, setAddSuppOpen] = useState(false);
  const [newSuppName, setNewSuppName] = useState('');
  const wellbeingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['nutrition', 'meals', today],
    queryFn: () => api.get<{ meals: NutritionMeal[] }>(`/nutrition/meals?date=${today}`),
    refetchInterval: 10_000,
  });

  const { data: wellbeingData } = useQuery({
    queryKey: ['nutrition', 'wellbeing', today],
    queryFn: () => api.get<WellbeingLog>(`/nutrition/wellbeing?date=${today}`).catch(() => null),
    staleTime: 30_000,
  });

  const { data: supplementsData } = useQuery({
    queryKey: ['nutrition', 'supplements'],
    queryFn: () => api.get<{ supplements: Supplement[] }>('/nutrition/supplements?active_only=true'),
    staleTime: 60_000,
  });

  const { data: suppEntriesData } = useQuery({
    queryKey: ['nutrition', 'supplement-entries', today],
    queryFn: () => api.get<{ entries: (SupplementEntry & { supplement_id: string }) }>(`/nutrition/supplements/entries?date=${today}`),
    staleTime: 30_000,
  });

  // Sync wellbeing form from loaded data
  const [wellbeingInitialized, setWellbeingInitialized] = useState(false);
  if (wellbeingData && !wellbeingInitialized) {
    setWellbeingForm({
      symptoms: wellbeingData.symptoms ?? [],
      mood: wellbeingData.mood,
      energy: wellbeingData.energy,
      sleep_quality: wellbeingData.sleep_quality,
      sleep_hours: wellbeingData.sleep_hours,
      anxiety: wellbeingData.anxiety,
      notes: wellbeingData.notes,
    });
    setWellbeingInitialized(true);
  }

  function updateWellbeing(patch: Partial<WellbeingLog>) {
    const next = { ...wellbeingForm, ...patch };
    setWellbeingForm(next);
    if (wellbeingTimer.current) clearTimeout(wellbeingTimer.current);
    wellbeingTimer.current = setTimeout(async () => {
      try {
        await api.post('/nutrition/wellbeing', { log_date: today, ...next });
        qc.invalidateQueries({ queryKey: ['nutrition', 'wellbeing', today] });
      } catch {
        // silent — will retry on next change
      }
    }, 1000);
  }

  function toggleSymptom(code: string) {
    const symptoms = wellbeingForm.symptoms ?? [];
    const next = symptoms.includes(code)
      ? symptoms.filter((s) => s !== code)
      : [...symptoms, code];
    updateWellbeing({ symptoms: next });
  }

  async function logSupplement() {
    if (!selectedSuppId) return;
    const supp = supplementsData?.supplements?.find((s) => s.id === selectedSuppId);
    if (!supp) return;
    await api.post('/nutrition/supplements/entries', {
      supplement_id: selectedSuppId,
      entry_date: today,
      dose: suppDose ? Number(suppDose) : supp.default_dose ?? undefined,
      dose_unit: supp.dose_unit ?? undefined,
    });
    setSuppDose('');
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplement-entries', today] });
  }

  async function deleteSuppEntry(entryId: string) {
    await api.delete(`/nutrition/supplements/entries/${entryId}`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplement-entries', today] });
  }

  async function addNewSupplement() {
    if (!newSuppName.trim()) return;
    await api.post('/nutrition/supplements', { name: newSuppName.trim() });
    setNewSuppName('');
    setAddSuppOpen(false);
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplements'] });
  }

  const supplements = supplementsData?.supplements ?? [];
  const suppEntries = (suppEntriesData as any)?.entries ?? [];

  const mealsByType: Record<string, NutritionMeal[]> = {};
  for (const meal of data?.meals ?? []) {
    if (!mealsByType[meal.meal_type]) mealsByType[meal.meal_type] = [];
    mealsByType[meal.meal_type]!.push(meal);
  }

  async function handleDelete(meal: NutritionMeal) {
    if (!confirm(`Delete this ${meal.meal_type}?`)) return;
    await api.delete(`/nutrition/meals/${meal.id}`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'meals', today] });
  }

  async function handleReanalyze(meal: NutritionMeal) {
    await api.post(`/nutrition/meals/${meal.id}/analyze`);
  }

  return (
    <div className="today-tab">
      <h2 className="today-tab__title">
        {new Date(today + 'T12:00:00').toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </h2>

      {isLoading && <p className="today-tab__loading">Loading meals…</p>}

      <div className="today-tab__slots">
        {MEAL_TYPES.map((type) => {
          const meals = mealsByType[type] ?? [];
          return (
            <div key={type} className="meal-slot">
              <div className="meal-slot__header">
                <span className="meal-slot__label">{MEAL_LABELS[type]}</span>
                <button
                  className="meal-slot__add"
                  onClick={() => setUploadFor(type)}
                  title={`Log ${MEAL_LABELS[type]}`}
                >
                  + Log
                </button>
              </div>

              {meals.length === 0 && (
                <div className="meal-slot__empty">No {type} logged yet</div>
              )}

              {meals.map((meal) => (
                <div key={meal.id} className="meal-card">
                  <div className="meal-card__row">
                    <div className="meal-card__info">
                      {meal.analysis_json && (
                        <span className="meal-card__title">
                          {(meal.user_correction ?? meal.analysis_json as any)?.meal_title ?? type}
                        </span>
                      )}
                      {!meal.analysis_json && !meal.error_message && (
                        <span className="meal-card__analyzing">Analyzing…</span>
                      )}
                      {meal.error_message && (
                        <span className="meal-card__error">Analysis failed</span>
                      )}
                      {getCalories(meal) !== null && (
                        <span className="meal-card__calories">{getCalories(meal)} kcal</span>
                      )}
                      {getConfidence(meal) && (
                        <span className={`meal-card__confidence confidence--${getConfidence(meal)}`}>
                          {getConfidence(meal)} confidence
                        </span>
                      )}
                    </div>
                    <div className="meal-card__actions">
                      {meal.analysis_json && (
                        <button
                          className="meal-card__btn"
                          onClick={() => setCorrecting(meal)}
                        >
                          Edit
                        </button>
                      )}
                      {meal.error_message && (
                        <button
                          className="meal-card__btn"
                          onClick={() => handleReanalyze(meal)}
                        >
                          Retry
                        </button>
                      )}
                      <button
                        className="meal-card__btn meal-card__btn--danger"
                        onClick={() => handleDelete(meal)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {meal.user_note && (
                    <div className="meal-card__note">{meal.user_note}</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {uploadFor && (
        <MealUploadModal
          defaultMealType={uploadFor}
          onClose={() => setUploadFor(null)}
          onSuccess={() => {
            setUploadFor(null);
            qc.invalidateQueries({ queryKey: ['nutrition', 'meals', today] });
          }}
        />
      )}

      {correcting && (
        <MealCorrectionPanel
          meal={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            qc.invalidateQueries({ queryKey: ['nutrition', 'meals', today] });
          }}
        />
      )}

      {/* ── Wellbeing Section ─────────────────────────────────────── */}
      <div className="today-section">
        <button
          className="today-section__toggle"
          onClick={() => setWellbeingOpen((o) => !o)}
        >
          <span>How do I feel today?</span>
          <span>{wellbeingOpen ? '▲' : '▼'}</span>
        </button>

        {wellbeingOpen && (
          <div className="wellbeing-form">
            <div className="wellbeing-scores">
              {(['mood', 'energy', 'sleep_quality', 'anxiety'] as const).map((field) => {
                const labels: Record<string, string> = {
                  mood: 'Mood',
                  energy: 'Energy',
                  sleep_quality: 'Sleep Quality',
                  anxiety: 'Anxiety',
                };
                return (
                  <div key={field} className="wellbeing-score-row">
                    <span className="wellbeing-score-label">{labels[field]}</span>
                    <div className="dot-scale">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          className={`dot-btn ${(wellbeingForm[field] ?? 0) >= n ? 'dot-btn--active' : ''}`}
                          onClick={() => updateWellbeing({ [field]: n })}
                          title={String(n)}
                        >
                          ●
                        </button>
                      ))}
                      <span className="dot-value">{wellbeingForm[field] ?? '—'}/5</span>
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
                  value={wellbeingForm.sleep_hours ?? ''}
                  onChange={(e) => updateWellbeing({ sleep_hours: Number(e.target.value) || undefined })}
                />
              </div>
            </div>

            <div className="symptom-chips">
              <span className="symptom-chips__label">Symptoms</span>
              <div className="symptom-chips__grid">
                {SYMPTOM_CODES.map((code) => (
                  <button
                    key={code}
                    className={`symptom-chip ${(wellbeingForm.symptoms ?? []).includes(code) ? 'symptom-chip--active' : ''}`}
                    onClick={() => toggleSymptom(code)}
                  >
                    {SYMPTOM_LABELS[code]}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">Notes (optional)</label>
              <textarea
                className="form-input"
                rows={2}
                maxLength={500}
                placeholder="How are you feeling today?"
                value={wellbeingForm.notes ?? ''}
                onChange={(e) => updateWellbeing({ notes: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Supplements Section ───────────────────────────────────── */}
      <div className="today-section">
        <button
          className="today-section__toggle"
          onClick={() => setSupplementsOpen((o) => !o)}
        >
          <span>Supplements today</span>
          <span>{supplementsOpen ? '▲' : '▼'}</span>
        </button>

        {supplementsOpen && (
          <div className="supplements-today">
            <div className="supplements-today__log">
              <select
                className="form-input form-input--sm"
                value={selectedSuppId}
                onChange={(e) => {
                  setSelectedSuppId(e.target.value);
                  const s = supplements.find((x) => x.id === e.target.value);
                  setSuppDose(s?.default_dose != null ? String(s.default_dose) : '');
                }}
              >
                <option value="">Select supplement…</option>
                {supplements.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.default_dose ? ` (${s.default_dose}${s.dose_unit ?? ''})` : ''}
                  </option>
                ))}
              </select>
              {selectedSuppId && (
                <input
                  className="form-input form-input--sm"
                  type="number"
                  step="any"
                  placeholder="dose"
                  value={suppDose}
                  onChange={(e) => setSuppDose(e.target.value)}
                  style={{ width: 80 }}
                />
              )}
              <button className="btn btn--sm" onClick={logSupplement} disabled={!selectedSuppId}>
                + Log
              </button>
              <button className="btn btn--sm btn--ghost" onClick={() => setAddSuppOpen((o) => !o)}>
                + Add to catalog
              </button>
            </div>

            {addSuppOpen && (
              <div className="supplements-today__add">
                <input
                  className="form-input form-input--sm"
                  placeholder="Supplement name…"
                  value={newSuppName}
                  onChange={(e) => setNewSuppName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addNewSupplement()}
                />
                <button className="btn btn--sm btn--primary" onClick={addNewSupplement}>Save</button>
              </div>
            )}

            <div className="suppentries">
              {suppEntries.length === 0 && <span className="suppentries__empty">No supplements logged today</span>}
              {suppEntries.map((e: any) => {
                const supp = supplements.find((s) => s.id === e.supplement_id);
                return (
                  <span key={e.id} className="supp-pill">
                    {supp?.name ?? 'Unknown'}
                    {e.dose ? ` ${e.dose}${e.dose_unit ?? ''}` : ''}
                    <button className="supp-pill__remove" onClick={() => deleteSuppEntry(e.id)}>✕</button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
