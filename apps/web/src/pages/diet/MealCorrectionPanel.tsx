import { useState } from 'react';
import { api } from '@/lib/api';

interface NutritionMeal {
  id: string;
  meal_type: string;
  analysis_json: Record<string, unknown> | null;
  user_correction: Record<string, unknown> | null;
  accepted: boolean;
}

interface Props {
  meal: NutritionMeal;
  onClose: () => void;
  onSaved: () => void;
}

interface Ingredient {
  name: string;
  quantity: string;
  calories_estimate: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export function MealCorrectionPanel({ meal, onClose, onSaved }: Props) {
  const source = meal.user_correction ?? meal.analysis_json ?? {};
  const aiSource = meal.analysis_json ?? {};

  const [title, setTitle] = useState<string>((source as any).meal_title ?? '');
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    ((source as any).ingredients ?? []) as Ingredient[],
  );
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateIngredient(idx: number, field: keyof Ingredient, value: string | number) {
    setIngredients((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      return next;
    });
  }

  function computeTotals() {
    return ingredients.reduce(
      (acc, ing) => ({
        calories: acc.calories + (ing.calories_estimate || 0),
        protein_g: acc.protein_g + (ing.protein_g || 0),
        carbs_g: acc.carbs_g + (ing.carbs_g || 0),
        fat_g: acc.fat_g + (ing.fat_g || 0),
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    );
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setError(null);
    try {
      const payload = {
        ingredients: ingredients.map((i) => ({ name: i.name, quantity: i.quantity })),
      };
      const result = await api.post<{ ingredients: Ingredient[] }>(
        `/nutrition/meals/${meal.id}/recalculate`,
        payload,
      );
      if (result.ingredients && Array.isArray(result.ingredients)) {
        setIngredients(result.ingredients.map((ai, idx) => ({
          name: ingredients[idx]?.name ?? ai.name,
          quantity: ingredients[idx]?.quantity ?? ai.quantity,
          calories_estimate: ai.calories_estimate ?? 0,
          protein_g: ai.protein_g ?? 0,
          carbs_g: ai.carbs_g ?? 0,
          fat_g: ai.fat_g ?? 0,
        })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recalculation failed');
    } finally {
      setRecalculating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const correction = {
        ...(source as object),
        meal_title: title,
        ingredients,
        totals: computeTotals(),
        _corrected_at: Date.now(),
      };
      await api.patch(`/nutrition/meals/${meal.id}/correction`, {
        user_correction: correction,
        accepted: true,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const totals = computeTotals();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Edit Meal Analysis</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="correction-panel">
          {meal.user_correction && (
            <div className="correction-panel__notice">
              You have a saved correction for this meal. The original AI analysis is shown below for reference.
            </div>
          )}

          <div className="form-row">
            <label className="form-label">Meal Title</label>
            <input
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <table className="ingredients-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Quantity</th>
                <th>Calories</th>
                <th>Protein (g)</th>
                <th>Carbs (g)</th>
                <th>Fat (g)</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ing, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      className="table-input"
                      value={ing.name}
                      onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="table-input"
                      value={ing.quantity}
                      onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="table-input table-input--num"
                      type="number"
                      value={ing.calories_estimate}
                      onChange={(e) => updateIngredient(idx, 'calories_estimate', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="table-input table-input--num"
                      type="number"
                      value={ing.protein_g}
                      onChange={(e) => updateIngredient(idx, 'protein_g', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="table-input table-input--num"
                      type="number"
                      value={ing.carbs_g}
                      onChange={(e) => updateIngredient(idx, 'carbs_g', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="table-input table-input--num"
                      type="number"
                      value={ing.fat_g}
                      onChange={(e) => updateIngredient(idx, 'fat_g', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="ingredients-table__totals">
                <td colSpan={2}><strong>Totals</strong></td>
                <td><strong>{Math.round(totals.calories)}</strong></td>
                <td><strong>{totals.protein_g.toFixed(1)}</strong></td>
                <td><strong>{totals.carbs_g.toFixed(1)}</strong></td>
                <td><strong>{totals.fat_g.toFixed(1)}</strong></td>
              </tr>
            </tfoot>
          </table>

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              className="btn btn--secondary"
              onClick={handleRecalculate}
              disabled={recalculating || ingredients.length === 0}
            >
              {recalculating ? 'Recalculating…' : 'Recalculate Macros with AI'}
            </button>
          </div>

          {meal.user_correction && (
            <details className="correction-panel__original">
              <summary>Original AI Analysis</summary>
              <pre className="correction-panel__json">
                {JSON.stringify(aiSource, null, 2)}
              </pre>
            </details>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Correction'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
