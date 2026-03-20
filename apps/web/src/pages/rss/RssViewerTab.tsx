import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ArticleCard, type ArticleData } from './ArticleCard';

interface Feed {
  id: string;
  title: string;
}

interface ArticlesResponse {
  articles: ArticleData[];
  total: number;
}

interface FeedsResponse {
  feeds: Feed[];
}

const FEEDBACK_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'liked', label: 'Liked' },
  { value: 'disliked', label: 'Disliked' },
];

export function RssViewerTab() {
  const [page, setPage] = useState(1);
  const [feedId, setFeedId] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const limit = 20;

  const { data: feedsData } = useQuery<FeedsResponse>({
    queryKey: ['rss', 'feeds'],
    queryFn: () => api.get('/rss/feeds'),
  });

  const feeds = feedsData?.feeds ?? [];

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(feedId ? { feedId } : {}),
    ...(feedbackFilter ? { feedback: feedbackFilter } : {}),
    ...(unreadOnly ? { unreadOnly: 'true' } : {}),
  });

  const { data, isLoading, refetch } = useQuery<ArticlesResponse>({
    queryKey: ['rss', 'articles', page, feedId, feedbackFilter, unreadOnly],
    queryFn: () => api.get(`/rss/articles?${params}`),
  });

  const articles = data?.articles ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Build feed title map
  const feedTitles: Record<string, string> = {};
  for (const f of feeds) feedTitles[f.id] = f.title;

  // Split into featured (first with image) and rest
  const withTitles = articles.map((a) => ({ ...a, feedTitle: feedTitles[a.feed_id] }));
  const featured = page === 1 ? withTitles.find((a) => a.image_url) : undefined;
  const rest = featured ? withTitles.filter((a) => a.id !== featured.id) : withTitles;

  // Date header
  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="np-viewer">
      {/* Masthead */}
      <div className="np-masthead">
        <div className="np-masthead__rule" />
        <div className="np-masthead__content">
          <h1 className="np-masthead__title">The Daily Feed</h1>
          <span className="np-masthead__date">{todayStr}</span>
          <span className="np-masthead__count">{total} articles</span>
        </div>
        <div className="np-masthead__rule" />
      </div>

      {/* Filter bar */}
      <div className="np-filters">
        <select
          value={feedId}
          onChange={(e) => { setFeedId(e.target.value); setPage(1); }}
          className="np-select"
        >
          <option value="">All sources</option>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>{f.title}</option>
          ))}
        </select>

        <select
          value={feedbackFilter}
          onChange={(e) => { setFeedbackFilter(e.target.value); setPage(1); }}
          className="np-select"
        >
          {FEEDBACK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="np-checkbox">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }}
          />
          Unread only
        </label>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="np-loading">Loading articles...</div>
      ) : articles.length === 0 ? (
        <div className="np-empty">
          <div className="np-empty__icon">📰</div>
          <h3>No articles yet</h3>
          <p>Add feeds in My Feeds and click Collect Now in Settings, or wait for the next scheduled collection.</p>
        </div>
      ) : (
        <>
          {/* Featured article */}
          {featured && (
            <ArticleCard article={featured} onUpdate={refetch} variant="featured" />
          )}

          {/* Grid of cards */}
          <div className="np-grid">
            {rest.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                onUpdate={refetch}
                variant="card"
              />
            ))}
          </div>
        </>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="np-pagination">
          <button
            className="np-page-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ← Newer
          </button>
          <span className="np-page-info">
            Page {page} of {totalPages}
          </span>
          <button
            className="np-page-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
