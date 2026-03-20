import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface WeeklyReview {
  id: string;
  week_key: string;
  payload: {
    what_went_well: string[];
    gap_areas: string[];
    practical_suggestions: string[];
    meals_worth_repeating: string[];
    underrepresented_nutrients: string[];
    suggested_recipe_directions: string[];
    overall_summary: string;
    symptom_patterns?: string[];
    supplement_notes?: string[];
    disclaimer: string;
  };
  created_at: number;
}

interface WeeklyCheckIn {
  week_key: string;
  weight: number | null;
  weight_unit: 'kg' | 'lbs' | null;
  body_fat_pct: number | null;
  rating: number | null;
  notes: string | null;
}

function currentWeekKey(): string {
  const now = new Date();
  const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const thu = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4 - dow));
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

export function WeeklyReviewsTab() {
  const weekKey = currentWeekKey();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checkInForm, setCheckInForm] = useState<Partial<WeeklyCheckIn>>({ week_key: weekKey });
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: reviewsData, isLoading: reviewsLoading } = useQuery({
    queryKey: ['nutrition', 'reviews', 'weekly'],
    queryFn: () => api.get<{ reviews: WeeklyReview[] }>('/nutrition/reviews/weekly?limit=12'),
  });

  const { data: checkInData } = useQuery({
    queryKey: ['nutrition', 'checkin', weekKey],
    queryFn: () =>
      api.get<WeeklyCheckIn>(`/nutrition/checkin/${weekKey}`).catch(() => null),
  });

  const reviews = reviewsData?.reviews ?? [];
  const currentCheckIn = checkInData;
  const hasCurrentReview = reviews.some((r) => r.week_key === weekKey);

  async function handleCheckInSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCheckInError(null);
    setSubmittingCheckIn(true);
    try {
      await api.post('/nutrition/checkin', { ...checkInForm, week_key: weekKey });
      qc.invalidateQueries({ queryKey: ['nutrition', 'checkin', weekKey] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'reviews', 'weekly'] });
    } catch (err) {
      setCheckInError(err instanceof Error ? err.message : 'Failed to submit check-in');
    } finally {
      setSubmittingCheckIn(false);
    }
  }

  async function handleGenerateNow() {
    setGenerating(true);
    setGenerateMsg(null);
    try {
      await api.post('/nutrition/reviews/weekly/generate', { week_key: weekKey });
      setGenerateMsg('Review generation started. It will appear here shortly.');
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['nutrition', 'reviews', 'weekly'] });
      }, 5000);
    } catch (err) {
      setGenerateMsg(err instanceof Error ? err.message : 'Failed to trigger generation');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="reviews-tab">
      <div className="reviews-tab__header">
        <h2>Weekly Reviews</h2>
        <button
          className="btn btn--sm"
          onClick={handleGenerateNow}
          disabled={generating}
          title="Generate a weekly review for the current week using available data"
        >
          {generating ? 'Generating…' : 'Generate Review Now'}
        </button>
      </div>
      {generateMsg && <div className="form-info">{generateMsg}</div>}

      {/* Check-in form for current week if no check-in yet */}
      {!currentCheckIn && !hasCurrentReview && (
        <div className="checkin-form-card">
          <h3>Weekly Check-In — {weekKey}</h3>
          <p className="checkin-form-card__desc">
            Log your weekly metrics to generate a personalized weekly review.
          </p>
          <form onSubmit={handleCheckInSubmit} className="checkin-form">
            <div className="checkin-form__row">
              <div className="form-row">
                <label className="form-label">Weight</label>
                <input
                  className="form-input form-input--sm"
                  type="number"
                  step="0.1"
                  placeholder="e.g. 75"
                  value={checkInForm.weight ?? ''}
                  onChange={(e) => setCheckInForm((p) => ({ ...p, weight: Number(e.target.value) || undefined }))}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Unit</label>
                <select
                  className="form-input form-input--sm"
                  value={checkInForm.weight_unit ?? 'kg'}
                  onChange={(e) => setCheckInForm((p) => ({ ...p, weight_unit: e.target.value as any }))}
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
                  placeholder="optional"
                  value={checkInForm.body_fat_pct ?? ''}
                  onChange={(e) => setCheckInForm((p) => ({ ...p, body_fat_pct: Number(e.target.value) || undefined }))}
                />
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">Week Rating (1–5)</label>
              <div className="star-rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`star ${(checkInForm.rating ?? 0) >= n ? 'star--active' : ''}`}
                    onClick={() => setCheckInForm((p) => ({ ...p, rating: n }))}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="How did this week go? Any observations…"
                value={checkInForm.notes ?? ''}
                onChange={(e) => setCheckInForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>

            {checkInError && <div className="form-error">{checkInError}</div>}

            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submittingCheckIn}>
                {submittingCheckIn ? 'Submitting…' : 'Submit Check-In & Generate Review'}
              </button>
            </div>
          </form>
        </div>
      )}

      {currentCheckIn && !hasCurrentReview && (
        <div className="checkin-submitted-notice">
          Check-in for {weekKey} submitted. Weekly review is being generated…
        </div>
      )}

      {reviewsLoading && <p className="tab-loading">Loading weekly reviews…</p>}

      {!reviewsLoading && reviews.length === 0 && (
        <p className="tab-empty">No weekly reviews yet. Submit a check-in to generate one.</p>
      )}

      <div className="review-list">
        {reviews.map((review) => {
          const isOpen = expanded === review.id;
          const p = review.payload;
          return (
            <div key={review.id} className="review-card">
              <button
                className="review-card__toggle"
                onClick={() => setExpanded(isOpen ? null : review.id)}
              >
                <span className="review-card__date">{review.week_key}</span>
                <span className="review-card__chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="review-card__body">
                  {p.overall_summary && (
                    <div className="review-card__section">
                      <h4>Summary</h4>
                      <p>{p.overall_summary}</p>
                    </div>
                  )}

                  {p.what_went_well?.length > 0 && (
                    <div className="review-card__section">
                      <h4>What Went Well</h4>
                      <ul>{p.what_went_well.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}

                  {p.gap_areas?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Gap Areas</h4>
                      <ul>{p.gap_areas.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    </div>
                  )}

                  {p.practical_suggestions?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Practical Suggestions</h4>
                      <ul>{p.practical_suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}

                  {p.underrepresented_nutrients?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Underrepresented Nutrients</h4>
                      <ul>{p.underrepresented_nutrients.map((n, i) => <li key={i}>{n}</li>)}</ul>
                    </div>
                  )}

                  {p.meals_worth_repeating?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Meals Worth Repeating</h4>
                      <ul>{p.meals_worth_repeating.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    </div>
                  )}

                  {p.symptom_patterns && p.symptom_patterns.length > 0 && (
                    <div className="review-card__section">
                      <h4>Food & Symptom Observations</h4>
                      <ul>{p.symptom_patterns.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}

                  {p.supplement_notes && p.supplement_notes.length > 0 && (
                    <div className="review-card__section">
                      <h4>Supplement Notes</h4>
                      <ul>{p.supplement_notes.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}

                  <p className="review-card__disclaimer">{p.disclaimer}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
