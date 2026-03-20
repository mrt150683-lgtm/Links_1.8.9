import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RecipeCard } from './RecipeCard';

type Category = 'all' | 'starter' | 'main' | 'dessert' | 'snack';

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

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'starter', label: 'Starters' },
  { id: 'main', label: 'Mains' },
  { id: 'dessert', label: 'Desserts' },
  { id: 'snack', label: 'Snacks' },
];

export function RecipeBookTab() {
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const qc = useQueryClient();

  const { data: bookData, isLoading: bookLoading } = useQuery({
    queryKey: ['nutrition', 'recipe-book', category],
    queryFn: () =>
      api.get<{ recipes: Recipe[]; total: number }>(
        `/nutrition/recipe-book${category !== 'all' ? `?category=${category}` : ''}`,
      ),
    enabled: !search,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['nutrition', 'recipe-book', 'search', search],
    queryFn: () =>
      api.get<{ recipes: Recipe[] }>(`/nutrition/recipe-book/search?q=${encodeURIComponent(search)}&limit=30`),
    enabled: !!search,
  });

  const recipes = search ? (searchData?.recipes ?? []) : (bookData?.recipes ?? []);
  const isLoading = search ? searchLoading : bookLoading;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearch('');
    setSearchInput('');
  }

  return (
    <div className="recipe-book-tab">
      <h2>Recipe Book</h2>
      <p className="recipe-book-tab__desc">Your liked recipes, saved for quick reference.</p>

      <div className="recipe-book-tab__toolbar">
        <form className="search-bar" onSubmit={handleSearch}>
          <input
            className="form-input search-bar__input"
            placeholder="Search recipes, ingredients…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn--sm">Search</button>
          {search && (
            <button type="button" className="btn btn--sm btn--secondary" onClick={clearSearch}>
              Clear
            </button>
          )}
        </form>

        {!search && (
          <div className="category-tabs">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`category-tab ${category === cat.id ? 'category-tab--active' : ''}`}
                onClick={() => setCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && <p className="tab-loading">Loading recipes…</p>}

      {!isLoading && recipes.length === 0 && (
        <p className="tab-empty">
          {search
            ? `No recipes match "${search}".`
            : 'No liked recipes yet. Generate recipes and like the ones you want to keep!'}
        </p>
      )}

      <div className="recipe-book-tab__list">
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onFeedbackChange={() => {
              qc.invalidateQueries({ queryKey: ['nutrition', 'recipe-book'] });
            }}
          />
        ))}
      </div>
    </div>
  );
}
