import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DailyReview {
  id: string;
  review_date: string;
  payload: {
    totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    disclaimer: string;
  };
}

interface WeeklyCheckIn {
  id: string;
  week_key: string;
  weight: number | null;
  weight_unit: 'kg' | 'lbs' | null;
  body_fat_pct: number | null;
  rating: number | null;
  submitted_at: number;
}

const CALORIE_GOAL = 2000;
const PROTEIN_GOAL = 150;
const CARBS_GOAL = 200;
const FAT_GOAL = 65;

function bar(value: number, goal: number, color: string) {
  const pct = Math.min(100, Math.round((value / goal) * 100));
  return (
    <div className="progress-bar-wrap">
      <div
        className="progress-bar-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export function ProgressTab() {
  const { data: reviewsData, isLoading: reviewsLoading } = useQuery({
    queryKey: ['nutrition', 'reviews', 'daily-progress'],
    queryFn: () => api.get<{ reviews: DailyReview[] }>('/nutrition/reviews/daily?limit=14'),
  });

  const { data: checkInsData, isLoading: checkInsLoading } = useQuery({
    queryKey: ['nutrition', 'checkins-progress'],
    queryFn: () =>
      api.get<{ check_ins: WeeklyCheckIn[] }>('/nutrition/checkin/list?limit=8').catch(() => ({
        check_ins: [],
      })),
  });

  const reviews = (reviewsData?.reviews ?? []).slice().reverse(); // oldest first
  const checkIns = checkInsData?.check_ins ?? [];

  return (
    <div className="progress-tab">
      <h2>Progress</h2>
      <p className="progress-tab__desc">
        Calorie and macro trends from your daily nutrition reviews, and weight from weekly check-ins.
      </p>

      <section className="progress-section">
        <h3>Daily Calorie Trend (last 14 days)</h3>
        {reviewsLoading && <p className="tab-loading">Loading…</p>}
        {!reviewsLoading && reviews.length === 0 && (
          <p className="tab-empty">No daily reviews yet. Reviews are generated automatically each night.</p>
        )}
        {reviews.length > 0 && (
          <div className="progress-calories">
            {reviews.map((r) => {
              const cal = r.payload.totals.calories;
              const pct = Math.min(100, Math.round((cal / CALORIE_GOAL) * 100));
              const label = new Date(r.review_date + 'T00:00:00').toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div key={r.id} className="progress-cal-row">
                  <span className="progress-cal-row__label">{label}</span>
                  <div className="progress-bar-wrap">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: cal > CALORIE_GOAL * 1.1 ? 'var(--red-1, #f44)' : 'var(--accent)',
                      }}
                    />
                  </div>
                  <span className="progress-cal-row__value">{cal.toLocaleString()} kcal</span>
                </div>
              );
            })}
            <p className="progress-section__note">Goal line: {CALORIE_GOAL.toLocaleString()} kcal</p>
          </div>
        )}
      </section>

      <section className="progress-section">
        <h3>Average Macros (last 7 days)</h3>
        {reviewsLoading && <p className="tab-loading">Loading…</p>}
        {!reviewsLoading && reviews.length > 0 && (() => {
          const last7 = reviews.slice(-7);
          const avg = (key: keyof typeof last7[0]['payload']['totals']) =>
            Math.round(last7.reduce((s, r) => s + r.payload.totals[key], 0) / last7.length);
          const avgProt = avg('protein_g');
          const avgCarbs = avg('carbs_g');
          const avgFat = avg('fat_g');
          return (
            <div className="progress-macros">
              <div className="progress-macro-row">
                <span className="progress-macro-row__label">Protein</span>
                {bar(avgProt, PROTEIN_GOAL, '#4f8ef7')}
                <span className="progress-macro-row__value">{avgProt}g / {PROTEIN_GOAL}g</span>
              </div>
              <div className="progress-macro-row">
                <span className="progress-macro-row__label">Carbs</span>
                {bar(avgCarbs, CARBS_GOAL, '#f7a14f')}
                <span className="progress-macro-row__value">{avgCarbs}g / {CARBS_GOAL}g</span>
              </div>
              <div className="progress-macro-row">
                <span className="progress-macro-row__label">Fat</span>
                {bar(avgFat, FAT_GOAL, '#9b59b6')}
                <span className="progress-macro-row__value">{avgFat}g / {FAT_GOAL}g</span>
              </div>
            </div>
          );
        })()}
      </section>

      <section className="progress-section">
        <h3>Weight Trend (weekly check-ins)</h3>
        {checkInsLoading && <p className="tab-loading">Loading…</p>}
        {!checkInsLoading && checkIns.length === 0 && (
          <p className="tab-empty">No check-ins yet. Submit a weekly check-in in the Weekly Reviews tab.</p>
        )}
        {checkIns.length > 0 && (() => {
          const withWeight = checkIns.filter((c) => c.weight !== null);
          if (withWeight.length === 0) {
            return <p className="tab-empty">No weight data in check-ins yet.</p>;
          }
          const first = withWeight[withWeight.length - 1];
          const baseline = first.weight!;
          return (
            <div className="progress-weight">
              {withWeight
                .slice()
                .reverse()
                .map((c) => {
                  const delta = c.weight! - baseline;
                  return (
                    <div key={c.id} className="progress-weight-row">
                      <span className="progress-weight-row__label">{c.week_key}</span>
                      <span className="progress-weight-row__value">
                        {c.weight} {c.weight_unit ?? 'kg'}
                      </span>
                      <span
                        className="progress-weight-row__delta"
                        style={{ color: delta < 0 ? 'var(--green-1, #4caf50)' : delta > 0 ? 'var(--red-1, #f44)' : 'var(--text-2)' }}
                      >
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </span>
                      {c.body_fat_pct !== null && (
                        <span className="progress-weight-row__bf">{c.body_fat_pct}% BF</span>
                      )}
                      {c.rating !== null && (
                        <span className="progress-weight-row__rating">{'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}</span>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })()}
      </section>

      <p className="progress-tab__disclaimer" style={{ marginTop: '24px', fontSize: '12px', color: 'var(--text-2)' }}>
        Estimates are approximate and not a substitute for laboratory analysis.
      </p>
    </div>
  );
}
