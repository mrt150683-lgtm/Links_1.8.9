import { useState } from 'react';
import { api } from '@/lib/api';
import { RecipeCard } from './RecipeCard';

interface Recipe {
  id: string;
  title: string;
  category: 'starter' | 'main' | 'dessert' | 'snack';
  cuisine_tags: string[];
  key_ingredients: string[];
  flavor_profile: string | null;
  full_recipe: Record<string, unknown>;
  feedback: 'liked' | 'disliked' | null;
  generation_mode: string;
}

interface CravingResult {
  craving_interpreted_as: string;
  alternatives: Recipe[];
}

export function CravingsTab() {
  const [craving, setCraving] = useState('');
  const [result, setResult] = useState<CravingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!craving.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<CravingResult>('/nutrition/cravings', { craving });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Craving assistant failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cravings-tab">
      <h2>Craving Assistant</h2>
      <p className="cravings-tab__desc">
        Tell us what you're craving and we'll suggest 2–5 healthier alternatives.
      </p>

      <form className="cravings-form" onSubmit={handleSubmit}>
        <div className="cravings-form__row">
          <input
            className="form-input cravings-form__input"
            placeholder="I'm craving… (e.g. pizza, chocolate cake, chips)"
            value={craving}
            onChange={(e) => setCraving(e.target.value)}
            maxLength={500}
          />
          <button type="submit" className="btn btn--primary" disabled={loading || !craving.trim()}>
            {loading ? 'Finding alternatives…' : 'Find Alternatives'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>

      {result && (
        <div className="cravings-result">
          <div className="cravings-result__interpretation">
            <strong>Interpreted as:</strong> {result.craving_interpreted_as}
          </div>
          <h3>Alternatives</h3>
          <p className="cravings-result__legend">
            From closest match to healthiest deviation:
          </p>
          {result.alternatives.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
