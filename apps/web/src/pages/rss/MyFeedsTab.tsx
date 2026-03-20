import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Feed {
  id: string;
  url: string;
  title: string;
  description: string | null;
  enabled: boolean;
  trusted: boolean;
  last_fetched_at: number | null;
  error_count: number;
  last_error: string | null;
  post_frequency: string | null;
  pot_ids: string[];
}

interface FeedsResponse {
  feeds: Feed[];
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'Never';
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function MyFeedsTab() {
  const qc = useQueryClient();
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FeedsResponse>({
    queryKey: ['rss', 'feeds'],
    queryFn: () => api.get('/rss/feeds'),
  });

  const feeds = data?.feeds ?? [];

  async function handleAdd() {
    if (!addUrl.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await api.post('/rss/feeds', { url: addUrl.trim() });
      setAddUrl('');
      qc.invalidateQueries({ queryKey: ['rss'] });
    } catch (err: any) {
      setAddError(err?.message ?? 'Failed to add feed');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(feed: Feed) {
    try {
      await api.patch(`/rss/feeds/${feed.id}`, { enabled: !feed.enabled });
      qc.invalidateQueries({ queryKey: ['rss', 'feeds'] });
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.delete(`/rss/feeds/${id}`);
      qc.invalidateQueries({ queryKey: ['rss'] });
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  async function handleCollectNow() {
    try {
      await api.post('/rss/collect');
    } catch {
      // ignore
    }
  }

  return (
    <div className="rss-section">
      <h2 className="rss-section__title">My Feeds</h2>

      {/* Add Feed */}
      <div className="rss-form">
        <div className="rss-form__row" style={{ marginBottom: 0 }}>
          <input
            className="rss-form__input"
            type="url"
            placeholder="https://example.com/feed or https://example.com/rss.xml"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            disabled={adding}
          />
          <button className="btn-primary" onClick={handleAdd} disabled={adding || !addUrl.trim()}>
            {adding ? 'Adding…' : '+ Add Feed'}
          </button>
        </div>
        {addError && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{addError}</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn-secondary" onClick={handleCollectNow} style={{ fontSize: 12 }}>
          ⟳ Collect Now
        </button>
      </div>

      {isLoading ? (
        <div className="rss-spinner">Loading feeds…</div>
      ) : feeds.length === 0 ? (
        <div className="rss-empty">No feeds yet. Add one above to get started.</div>
      ) : (
        feeds.map((feed) => (
          <div key={feed.id} className="feed-card">
            <div className="feed-card__header">
              <div className="feed-card__title">{feed.title}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {feed.error_count > 0 && (
                  <span className="feed-card__badge feed-card__badge--error" title={feed.last_error ?? ''}>
                    {feed.error_count} errors
                  </span>
                )}
                {feed.post_frequency && (
                  <span className="feed-card__badge">{feed.post_frequency}</span>
                )}
              </div>
            </div>

            <div className="feed-card__url">{feed.url}</div>

            <div className="feed-card__meta">
              <span>Last fetched: {relativeTime(feed.last_fetched_at)}</span>
            </div>

            <div className="feed-card__actions">
              <button
                className={`article-action-btn${feed.enabled ? '' : ' article-action-btn--active-hide'}`}
                onClick={() => handleToggle(feed)}
                title={feed.enabled ? 'Disable feed' : 'Enable feed'}
              >
                {feed.enabled ? '✓ Enabled' : '✕ Disabled'}
              </button>

              {confirmDelete === feed.id ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Delete feed?</span>
                  <button
                    className="article-action-btn article-action-btn--active-dislike"
                    onClick={() => handleDelete(feed.id)}
                    disabled={deletingId === feed.id}
                  >
                    {deletingId === feed.id ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button className="article-action-btn" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="article-action-btn"
                  onClick={() => setConfirmDelete(feed.id)}
                  style={{ color: 'var(--danger)' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
