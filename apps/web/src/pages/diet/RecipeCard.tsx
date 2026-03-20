import { useState } from 'react';
import { api } from '@/lib/api';

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

interface Props {
  recipe: Recipe;
  onFeedbackChange?: () => void;
}

export function RecipeCard({ recipe, onFeedbackChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(recipe.feedback);
  const [saving, setSaving] = useState(false);

  const r = recipe.full_recipe as any;

  async function handleFeedback(fb: 'liked' | 'disliked') {
    setSaving(true);
    try {
      await api.post(`/nutrition/recipes/${recipe.id}/feedback`, { feedback: fb });
      setFeedback(fb);
      onFeedbackChange?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`recipe-card ${expanded ? 'recipe-card--expanded' : ''}`}>
      <div className="recipe-card__header">
        <div className="recipe-card__title-row">
          <span className="recipe-card__title">{recipe.title}</span>
          <span className={`recipe-card__category category--${recipe.category}`}>
            {recipe.category}
          </span>
        </div>

        <div className="recipe-card__tags">
          {recipe.cuisine_tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>

        {recipe.key_ingredients.length > 0 && (
          <div className="recipe-card__ingredients">
            <strong>Key ingredients:</strong> {recipe.key_ingredients.slice(0, 5).join(', ')}
            {recipe.key_ingredients.length > 5 && ` +${recipe.key_ingredients.length - 5} more`}
          </div>
        )}

        <div className="recipe-card__meta">
          {r.prep_time_minutes && <span>{r.prep_time_minutes}m prep</span>}
          {r.cook_time_minutes && <span>{r.cook_time_minutes}m cook</span>}
          {r.servings && <span>{r.servings} servings</span>}
          {r.estimated_calories_per_serving && (
            <span>~{r.estimated_calories_per_serving} kcal/serving</span>
          )}
        </div>

        <div className="recipe-card__actions">
          <button
            className={`recipe-card__feedback ${feedback === 'liked' ? 'feedback--liked' : ''}`}
            onClick={() => handleFeedback('liked')}
            disabled={saving}
            title="Like this recipe"
          >
            👍 {feedback === 'liked' ? 'Liked' : 'Like'}
          </button>
          <button
            className={`recipe-card__feedback ${feedback === 'disliked' ? 'feedback--disliked' : ''}`}
            onClick={() => handleFeedback('disliked')}
            disabled={saving}
            title="Dislike this recipe"
          >
            👎 {feedback === 'disliked' ? 'Disliked' : 'Dislike'}
          </button>
          <button
            className="recipe-card__expand"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide Recipe' : 'View Recipe'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="recipe-card__body">
          {r.description && <p className="recipe-card__description">{r.description}</p>}
          {r.why_suggested && (
            <div className="recipe-card__section">
              <h4>Why This Recipe</h4>
              <p>{r.why_suggested}</p>
            </div>
          )}
          {r.allergen_warnings?.length > 0 && (
            <div className="recipe-card__allergens">
              ⚠️ Allergens: {r.allergen_warnings.join(', ')}
            </div>
          )}
          {r.instructions?.length > 0 && (
            <div className="recipe-card__section">
              <h4>Instructions</h4>
              <ol className="recipe-card__steps">
                {(r.instructions as string[]).map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
