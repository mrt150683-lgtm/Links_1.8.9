import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DiscoveredFeed {
  url: string;
  title: string;
  description: string | null;
  site_url: string | null;
  example_articles: string[];
  post_frequency: string | null;
  verified: boolean;
  already_following: boolean;
}

interface DiscoverResponse {
  query: string;
  keywords: string[];
  feeds: DiscoveredFeed[];
}

export function DiscoverTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState('');
  const [expandedExamples, setExpandedExamples] = useState<Set<string>>(new Set());
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  async function handleDiscover() {
    if (!query.trim()) return;
    setIsLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post<DiscoverResponse>('/rss/discover', { query: query.trim() });
      setResult(res);
    } catch (err: any) {
      setError(err?.message ?? 'Feed discovery failed');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFollow(feed: DiscoveredFeed) {
    setAddingUrl(feed.url);
    try {
      await api.post('/rss/feeds', {
        url: feed.url,
        title: feed.title,
        description: feed.description,
      });
      setAddedUrls((prev) => new Set([...prev, feed.url]));
      qc.invalidateQueries({ queryKey: ['rss'] });
    } catch {
      // ignore — maybe already exists
      setAddedUrls((prev) => new Set([...prev, feed.url]));
    } finally {
      setAddingUrl(null);
    }
  }

  function toggleExamples(url: string) {
    setExpandedExamples((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  const isFollowing = (url: string) => addedUrls.has(url);

  return (
    <div className="rss-section">
      <h2 className="rss-section__title">Discover Feeds</h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
        Enter a topic and AI will suggest high-quality RSS feeds from authoritative sources.
      </p>

      <div className="rss-form">
        <div className="rss-form__row" style={{ marginBottom: 0 }}>
          <input
            className="rss-form__input"
            placeholder="e.g. AI safety, quantum computing, climate science…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleDiscover()}
            disabled={isLoading}
          />
          <button
            className="btn-primary"
            onClick={handleDiscover}
            disabled={isLoading || !query.trim()}
          >
            {isLoading ? 'Searching…' : 'Find Feeds'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="rss-spinner">Discovering feeds — this may take 10–30 seconds…</div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {result && (
        <>
          {result.keywords.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
              Keywords used: {result.keywords.join(', ')}
            </div>
          )}

          {result.feeds.length === 0 ? (
            <div className="rss-empty">No feeds found for this topic. Try a different query.</div>
          ) : (
            result.feeds.map((feed) => {
              const following = feed.already_following || isFollowing(feed.url);
              const showExamples = expandedExamples.has(feed.url);
              return (
                <div
                  key={feed.url}
                  className={`discover-card${feed.verified ? ' discover-card--verified' : ''}`}
                >
                  <div className="discover-card__header">
                    <div className="discover-card__title">{feed.title || feed.url}</div>
                    <button
                      className={`article-action-btn${following ? ' article-action-btn--active-like' : ''}`}
                      onClick={() => !following && handleFollow(feed)}
                      disabled={following || addingUrl === feed.url}
                      style={{ flexShrink: 0 }}
                    >
                      {addingUrl === feed.url
                        ? 'Adding…'
                        : following
                        ? '✓ Following'
                        : '+ Follow'}
                    </button>
                  </div>

                  <div className="discover-card__url">{feed.url}</div>

                  {feed.description && (
                    <div className="discover-card__description">{feed.description}</div>
                  )}

                  <div className="discover-card__meta">
                    {feed.post_frequency && (
                      <span className="feed-card__badge">{feed.post_frequency}</span>
                    )}
                    {feed.verified ? (
                      <span style={{ color: 'var(--success)', fontSize: 11 }}>✓ Verified</span>
                    ) : (
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Unverified</span>
                    )}
                  </div>

                  {feed.example_articles.length > 0 && (
                    <>
                      <button
                        className="discover-card__examples-toggle"
                        onClick={() => toggleExamples(feed.url)}
                      >
                        {showExamples ? '▲ Hide' : '▼ Show'} example articles
                      </button>
                      {showExamples && (
                        <div className="discover-card__examples">
                          <ul>
                            {feed.example_articles.map((title, i) => (
                              <li key={i}>{title}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
