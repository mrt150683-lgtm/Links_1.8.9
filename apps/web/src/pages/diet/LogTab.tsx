import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MealCorrectionPanel } from './MealCorrectionPanel';
import { MealUploadModal } from './MealUploadModal';

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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LogTab({ potId: _potId }: { potId: string }) {
  const [dateFilter, setDateFilter] = useState(todayKey());
  const [correcting, setCorrecting] = useState<NutritionMeal | null>(null);
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['nutrition', 'meals', dateFilter],
    queryFn: () => api.get<{ meals: NutritionMeal[] }>(`/nutrition/meals?date=${dateFilter}`),
  });

  async function handleDelete(meal: NutritionMeal) {
    if (!confirm(`Delete this ${meal.meal_type} entry?`)) return;
    await api.delete(`/nutrition/meals/${meal.id}`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'meals', dateFilter] });
  }

  async function handleReanalyze(meal: NutritionMeal) {
    await api.post(`/nutrition/meals/${meal.id}/analyze`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'meals', dateFilter] });
  }

  const meals = data?.meals ?? [];

  return (
    <div className="log-tab">
      <div className="log-tab__toolbar">
        <div className="log-tab__filters">
          <label className="form-label">Date</label>
          <input
            type="date"
            className="form-input"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" onClick={() => setUploading(true)}>
          + Log Meal
        </button>
      </div>

      {isLoading && <p className="log-tab__loading">Loading meals…</p>}

      {!isLoading && meals.length === 0 && (
        <p className="log-tab__empty">No meals logged for {dateFilter}.</p>
      )}

      <div className="log-tab__list">
        {meals.map((meal) => {
          const data = meal.user_correction ?? meal.analysis_json;
          const title = data ? (data as any).meal_title ?? meal.meal_type : meal.meal_type;
          const calories = data ? (data as any).totals?.calories ?? null : null;

          return (
            <div key={meal.id} className="log-meal-card">
              <div className="log-meal-card__header">
                <span className="log-meal-card__type">{meal.meal_type}</span>
                <span className="log-meal-card__title">{title}</span>
                {calories !== null && (
                  <span className="log-meal-card__calories">{Math.round(calories)} kcal</span>
                )}
                {meal.analysis_json && (
                  <span className={`confidence--${(meal.analysis_json as any).portion_confidence}`}>
                    {(meal.analysis_json as any).portion_confidence}
                  </span>
                )}
                {!meal.analysis_json && !meal.error_message && (
                  <span className="log-meal-card__analyzing">Analyzing…</span>
                )}
                {meal.error_message && (
                  <span className="log-meal-card__error">Failed</span>
                )}
              </div>

              {meal.user_note && (
                <div className="log-meal-card__note">{meal.user_note}</div>
              )}

              <div className="log-meal-card__actions">
                {meal.analysis_json && (
                  <button className="btn btn--sm" onClick={() => setCorrecting(meal)}>
                    Edit
                  </button>
                )}
                {meal.error_message && (
                  <button className="btn btn--sm" onClick={() => handleReanalyze(meal)}>
                    Retry
                  </button>
                )}
                <button className="btn btn--sm btn--danger" onClick={() => handleDelete(meal)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {uploading && (
        <MealUploadModal
          defaultMealType="snack"
          onClose={() => setUploading(false)}
          onSuccess={() => {
            setUploading(false);
            qc.invalidateQueries({ queryKey: ['nutrition', 'meals', dateFilter] });
          }}
        />
      )}

      {correcting && (
        <MealCorrectionPanel
          meal={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            qc.invalidateQueries({ queryKey: ['nutrition', 'meals', dateFilter] });
          }}
        />
      )}
    </div>
  );
}
