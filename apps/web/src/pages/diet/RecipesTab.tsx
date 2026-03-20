import { useState } from 'react';
import { api } from '@/lib/api';
import { RecipeCard } from './RecipeCard';

type Mode = 'random' | 'ingredient_led';

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

export function RecipesTab() {
  const [mode, setMode] = useState<Mode>('random');
  const [ingredientInput, setIngredientInput] = useState('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [mealType, setMealType] = useState('any');
  const [count, setCount] = useState(3);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addIngredient() {
    const val = ingredientInput.trim();
    if (val && !ingredients.includes(val)) {
      setIngredients((p) => [...p, val]);
    }
    setIngredientInput('');
  }

  function removeIngredient(ing: string) {
    setIngredients((p) => p.filter((i) => i !== ing));
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { mode, count };
      if (mealType !== 'any') body.meal_type = mealType;
      if (mode === 'ingredient_led' && ingredients.length > 0) {
        body.ingredients = ingredients;
      }
      const result = await api.post<{ recipes: Recipe[] }>('/nutrition/recipes/generate', body);
      setRecipes(result.recipes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="recipes-tab">
      <h2>Generate Recipes</h2>

      <div className="recipes-tab__controls">
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'random' ? 'mode-btn--active' : ''}`}
            onClick={() => setMode('random')}
          >
            Random
          </button>
          <button
            className={`mode-btn ${mode === 'ingredient_led' ? 'mode-btn--active' : ''}`}
            onClick={() => setMode('ingredient_led')}
          >
            By Ingredients
          </button>
        </div>

        {mode === 'ingredient_led' && (
          <div className="ingredient-input">
            <label className="form-label">Ingredients to feature</label>
            <div className="ingredient-chips">
              {ingredients.map((ing) => (
                <span key={ing} className="chip">
                  {ing}
                  <button className="chip__remove" onClick={() => removeIngredient(ing)}>✕</button>
                </span>
              ))}
              <input
                className="ingredient-chips__input"
                placeholder="Add ingredient…"
                value={ingredientInput}
                onChange={(e) => setIngredientInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addIngredient()}
              />
              <button className="btn btn--sm" onClick={addIngredient}>Add</button>
            </div>
          </div>
        )}

        <div className="recipes-tab__row">
          <div className="form-row">
            <label className="form-label">Meal Type</label>
            <select className="form-input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
              <option value="any">Any</option>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Count</label>
            <select className="form-input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </div>
        </div>

        <button className="btn btn--primary" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate Recipes'}
        </button>

        {error && <div className="form-error">{error}</div>}
      </div>

      {recipes.length > 0 && (
        <div className="recipe-results">
          <h3>{recipes.length} Recipe{recipes.length !== 1 ? 's' : ''} Generated</h3>
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
