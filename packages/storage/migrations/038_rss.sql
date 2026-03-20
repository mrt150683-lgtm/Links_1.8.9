-- 038: RSS Feed module tables
-- No table rebuild required; all RSS data lives in new dedicated tables.

CREATE TABLE rss_feeds (
  id              TEXT    PRIMARY KEY NOT NULL,
  url             TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  description     TEXT,
  site_url        TEXT,
  pot_ids         TEXT    NOT NULL DEFAULT '[]',  -- JSON array of pot IDs
  enabled         INTEGER NOT NULL DEFAULT 1,
  trusted         INTEGER NOT NULL DEFAULT 0,
  user_added      INTEGER NOT NULL DEFAULT 1,     -- 1=manual, 0=ai-suggested
  post_frequency  TEXT,                            -- 'daily'|'weekly'|'irregular'|null
  last_fetched_at INTEGER,
  error_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  fetch_etag      TEXT,
  fetch_modified  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_rss_feeds_enabled ON rss_feeds(enabled);

-- Fetched article items
CREATE TABLE rss_articles (
  id            TEXT    PRIMARY KEY NOT NULL,
  feed_id       TEXT    NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
  guid          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  url           TEXT    NOT NULL,
  author        TEXT,
  summary       TEXT,
  published_at  INTEGER,
  fetched_at    INTEGER NOT NULL,
  pot_tags      TEXT    NOT NULL DEFAULT '[]',   -- JSON: string[]
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_rss_articles_feed_guid ON rss_articles(feed_id, guid);
CREATE INDEX idx_rss_articles_published ON rss_articles(published_at DESC);
CREATE INDEX idx_rss_articles_fetched ON rss_articles(fetched_at DESC);
CREATE INDEX idx_rss_articles_feed ON rss_articles(feed_id);

-- Like / dislike / hide per article
CREATE TABLE rss_article_feedback (
  id          TEXT    PRIMARY KEY NOT NULL,
  article_id  TEXT    NOT NULL REFERENCES rss_articles(id) ON DELETE CASCADE,
  feedback    TEXT    NOT NULL CHECK(feedback IN ('liked','disliked','hidden')),
  created_at  INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_rss_feedback_article ON rss_article_feedback(article_id);

-- AI-suggested feeds (not yet added by user)
CREATE TABLE rss_feed_suggestions (
  id               TEXT    PRIMARY KEY NOT NULL,
  url              TEXT    NOT NULL,
  title            TEXT,
  description      TEXT,
  reason           TEXT,
  example_articles TEXT    NOT NULL DEFAULT '[]',  -- JSON: string[]
  post_frequency   TEXT,
  suggested_at     INTEGER NOT NULL,
  dismissed        INTEGER NOT NULL DEFAULT 0,
  added            INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_rss_feed_suggestions_dismissed ON rss_feed_suggestions(dismissed);
