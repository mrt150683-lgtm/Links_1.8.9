import { useState } from 'react';
import { api } from '@/lib/api';

export interface ArticleData {
  id: string;
  feed_id: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number;
  is_read: boolean;
  feedback: 'liked' | 'disliked' | 'hidden' | null;
  feedTitle?: string;
}

interface Props {
  article: ArticleData;
  onUpdate?: () => void;
  variant?: 'featured' | 'card' | 'compact';
}

function relativeTime(ts: number | null): string {
  if (!ts) return '';
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function ArticleCard({ article, onUpdate, variant = 'card' }: Props) {
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | 'hidden' | null>(
    article.feedback,
  );
  const [isRead, setIsRead] = useState(article.is_read);
  const [imgError, setImgError] = useState(false);

  if (feedback === 'hidden') return null;

  async function handleFeedback(type: 'liked' | 'disliked' | 'hidden') {
    try {
      if (feedback === type) {
        await api.delete(`/rss/articles/${article.id}/feedback`);
        setFeedback(null);
      } else {
        await api.post(`/rss/articles/${article.id}/feedback`, { feedback: type });
        setFeedback(type);
        if (type === 'hidden') onUpdate?.();
      }
    } catch {
      // ignore
    }
  }

  async function handleMarkRead() {
    try {
      await api.post(`/rss/articles/${article.id}/read`);
      setIsRead(true);
    } catch {
      // ignore
    }
  }

  function openArticle() {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(article.url);
    } else {
      window.open(article.url, '_blank', 'noopener,noreferrer');
    }
    if (!isRead) handleMarkRead();
  }

  const showImage = article.image_url && !imgError;
  const domain = getDomain(article.url);

  if (variant === 'featured') {
    return (
      <div className={`np-card np-card--featured${isRead ? ' np-card--read' : ''}`}>
        {showImage && (
          <div className="np-card__hero" onClick={openArticle} role="button" tabIndex={0}>
            <img src={article.image_url!} alt="" onError={() => setImgError(true)} />
          </div>
        )}
        <div className="np-card__body">
          <div className="np-card__source-row">
            {article.feedTitle && <span className="np-card__source">{article.feedTitle}</span>}
            <span className="np-card__dot">·</span>
            <span className="np-card__time">{relativeTime(article.published_at)}</span>
          </div>
          <h2 className="np-card__title np-card__title--featured" onClick={openArticle} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && openArticle()}>
            {article.title}
          </h2>
          {article.summary && (
            <p className="np-card__summary np-card__summary--featured">{article.summary}</p>
          )}
          <div className="np-card__footer">
            <span className="np-card__domain">{domain}</span>
            {article.author && <span className="np-card__author">by {article.author}</span>}
            <div className="np-card__actions">
              <button
                className={`np-btn${feedback === 'liked' ? ' np-btn--active' : ''}`}
                onClick={() => handleFeedback('liked')}
                title="Like"
              >▲</button>
              <button
                className={`np-btn${feedback === 'disliked' ? ' np-btn--active-down' : ''}`}
                onClick={() => handleFeedback('disliked')}
                title="Dislike"
              >▼</button>
              <button className="np-btn" onClick={() => handleFeedback('hidden')} title="Hide">✕</button>
              {!isRead && (
                <button className="np-btn" onClick={handleMarkRead} title="Mark as read">✓</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`np-row${isRead ? ' np-row--read' : ''}`}>
        <div className="np-row__body" onClick={openArticle} role="button" tabIndex={0}>
          <span className="np-row__title">{article.title}</span>
          <span className="np-row__meta">
            {article.feedTitle && <span className="np-card__source">{article.feedTitle}</span>}
            <span className="np-card__dot">·</span>
            <span>{relativeTime(article.published_at)}</span>
          </span>
        </div>
        <div className="np-row__actions">
          <button
            className={`np-btn np-btn--sm${feedback === 'liked' ? ' np-btn--active' : ''}`}
            onClick={() => handleFeedback('liked')} title="Like"
          >▲</button>
          <button
            className={`np-btn np-btn--sm${feedback === 'disliked' ? ' np-btn--active-down' : ''}`}
            onClick={() => handleFeedback('disliked')} title="Dislike"
          >▼</button>
          <button className="np-btn np-btn--sm" onClick={() => handleFeedback('hidden')} title="Hide">✕</button>
        </div>
      </div>
    );
  }

  // Default: card variant
  return (
    <div className={`np-card${isRead ? ' np-card--read' : ''}`}>
      <div className="np-card__layout">
        <div className="np-card__body">
          <div className="np-card__source-row">
            {article.feedTitle && <span className="np-card__source">{article.feedTitle}</span>}
            <span className="np-card__dot">·</span>
            <span className="np-card__time">{relativeTime(article.published_at)}</span>
          </div>
          <h3 className="np-card__title" onClick={openArticle} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && openArticle()}>
            {article.title}
          </h3>
          {article.summary && (
            <p className="np-card__summary">{article.summary}</p>
          )}
          <div className="np-card__footer">
            <span className="np-card__domain">{domain}</span>
            {article.author && <span className="np-card__author">by {article.author}</span>}
            <div className="np-card__actions">
              <button
                className={`np-btn${feedback === 'liked' ? ' np-btn--active' : ''}`}
                onClick={() => handleFeedback('liked')} title="Like"
              >▲</button>
              <button
                className={`np-btn${feedback === 'disliked' ? ' np-btn--active-down' : ''}`}
                onClick={() => handleFeedback('disliked')} title="Dislike"
              >▼</button>
              <button className="np-btn" onClick={() => handleFeedback('hidden')} title="Hide">✕</button>
              {!isRead && (
                <button className="np-btn" onClick={handleMarkRead} title="Mark as read">✓</button>
              )}
            </div>
          </div>
        </div>
        {showImage && (
          <div className="np-card__thumb" onClick={openArticle} role="button" tabIndex={0}>
            <img src={article.image_url!} alt="" onError={() => setImgError(true)} />
          </div>
        )}
      </div>
    </div>
  );
}

// Augment window for Electron API
declare global {
  interface Window {
    electronAPI?: {
      openExternal?: (url: string) => void;
    };
  }
}
