import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Suggestion {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  reason: string | null;
  example_articles: string[];
  post_frequency: string | null;
  dismissed: boolean;
  added: boolean;
}

interface SuggestionsResponse {
  suggestions: Suggestion[];
}

export function SuggestionsTab() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<SuggestionsResponse>({
    queryKey: ['rss', 'suggestions'],
    queryFn: () => api.get('/rss/suggestions'),
  });

  const suggestions = data?.suggestions ?? [];

  async function handleAdd(id: string) {
    try {
      await api.post(`/rss/suggestions/${id}/add`);
      qc.invalidateQueries({ queryKey: ['rss'] });
    } catch {
      // ignore
    }
  }

  async function handleDismiss(id: string) {
    try {
      await api.post(`/rss/suggestions/${id}/dismiss`);
      qc.invalidateQueries({ queryKey: ['rss', 'suggestions'] });
    } catch {
      // ignore
    }
  }

  return (
    <div className="rss-section">
      <h2 className="rss-section__title">Suggestions</h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
        AI-recommended feeds based on your discovery searches and reading activity.
      </p>

      {isLoading ? (
        <div className="rss-spinner">Loading suggestions…</div>
      ) : suggestions.length === 0 ? (
        <div className="rss-empty">
          No suggestions yet. Use Discover to search for feeds — results are saved here for later.
        </div>
      ) : (
        suggestions.map((s) => (
          <div key={s.id} className="suggestion-card">
            <div className="suggestion-card__title">{s.title ?? s.url}</div>
            <div className="suggestion-card__url">{s.url}</div>
            {s.reason && <div className="suggestion-card__reason">{s.reason}</div>}
            {s.example_articles.length > 0 && (
              <div className="suggestion-card__examples">
                <strong>Example articles:</strong>
                <ul>
                  {s.example_articles.slice(0, 3).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="suggestion-card__actions">
              <button className="btn-primary" onClick={() => handleAdd(s.id)}>
                + Follow
              </button>
              <button className="btn-secondary" onClick={() => handleDismiss(s.id)}>
                Dismiss
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
