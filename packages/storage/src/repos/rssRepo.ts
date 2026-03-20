/**
 * RSS Feed Repository
 *
 * CRUD for:
 *   - rss_feeds
 *   - rss_articles
 *   - rss_article_feedback
 *   - rss_feed_suggestions
 *
 * Migration: 038_rss.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  RssFeed,
  RssArticle,
  RssFeedSuggestion,
  RssSettings,
  CreateRssFeedInput,
  UpdateRssFeedInput,
  UpsertRssArticleInput,
  CreateRssFeedSuggestionInput,
} from '../types.js';
import { getPreference, setPreference } from './prefsRepo.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toRssFeed(row: any): RssFeed {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    site_url: row.site_url,
    pot_ids: JSON.parse(row.pot_ids ?? '[]'),
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    user_added: row.user_added === 1,
    post_frequency: row.post_frequency,
    last_fetched_at: row.last_fetched_at,
    error_count: row.error_count,
    last_error: row.last_error,
    fetch_etag: row.fetch_etag,
    fetch_modified: row.fetch_modified,
    created_at: row.created_at as number,
    updated_at: row.updated_at,
  };
}

function toRssArticle(row: any, feedback?: 'liked' | 'disliked' | 'hidden' | null): RssArticle {
  return {
    id: row.id,
    feed_id: row.feed_id,
    guid: row.guid,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary,
    image_url: row.image_url ?? null,
    published_at: row.published_at,
    fetched_at: row.fetched_at,
    pot_tags: JSON.parse(row.pot_tags ?? '[]'),
    is_read: row.is_read === 1,
    created_at: row.created_at as number,
    feedback: feedback ?? null,
  };
}

function toRssFeedSuggestion(row: any): RssFeedSuggestion {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    reason: row.reason,
    example_articles: JSON.parse(row.example_articles ?? '[]'),
    post_frequency: row.post_frequency,
    suggested_at: row.suggested_at,
    dismissed: row.dismissed === 1,
    added: row.added === 1,
  };
}

// ── RSS Settings ──────────────────────────────────────────────────────────

const DEFAULT_RSS_SETTINGS: RssSettings = {
  enabled: true,
  collect_time: '06:00',
  articles_per_page: 10,
  retention_days: 30,
};

export async function getRssSettings(): Promise<RssSettings> {
  const stored = await getPreference<RssSettings>('rss.settings');
  return { ...DEFAULT_RSS_SETTINGS, ...(stored ?? {}) };
}

export async function updateRssSettings(patch: Partial<RssSettings>): Promise<RssSettings> {
  const current = await getRssSettings();
  const updated = { ...current, ...patch };
  await setPreference('rss.settings', updated);
  return updated;
}

// ── Feeds ─────────────────────────────────────────────────────────────────

export async function createRssFeed(input: CreateRssFeedInput): Promise<RssFeed> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('rss_feeds')
    .values({
      id,
      url: input.url,
      title: input.title,
      description: input.description ?? null,
      site_url: input.site_url ?? null,
      pot_ids: JSON.stringify(input.pot_ids ?? []),
      enabled: 1,
      trusted: input.trusted ? 1 : 0,
      user_added: input.user_added === false ? 0 : 1,
      post_frequency: input.post_frequency ?? null,
      last_fetched_at: null,
      error_count: 0,
      last_error: null,
      fetch_etag: input.fetch_etag ?? null,
      fetch_modified: input.fetch_modified ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return {
    id,
    url: input.url,
    title: input.title,
    description: input.description ?? null,
    site_url: input.site_url ?? null,
    pot_ids: input.pot_ids ?? [],
    enabled: true,
    trusted: input.trusted ?? false,
    user_added: input.user_added !== false,
    post_frequency: input.post_frequency ?? null,
    last_fetched_at: null,
    error_count: 0,
    last_error: null,
    fetch_etag: input.fetch_etag ?? null,
    fetch_modified: input.fetch_modified ?? null,
    created_at: now,
    updated_at: now,
  };
}

export async function getRssFeed(id: string): Promise<RssFeed | undefined> {
  const db = getDatabase();
  const row = await db.selectFrom('rss_feeds').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toRssFeed(row) : undefined;
}

export async function getRssFeedByUrl(url: string): Promise<RssFeed | undefined> {
  const db = getDatabase();
  const row = await db.selectFrom('rss_feeds').selectAll().where('url', '=', url).executeTakeFirst();
  return row ? toRssFeed(row) : undefined;
}

export async function listRssFeeds(enabledOnly?: boolean): Promise<RssFeed[]> {
  const db = getDatabase();
  let q = db.selectFrom('rss_feeds').selectAll().orderBy('created_at', 'asc');
  if (enabledOnly) {
    q = q.where('enabled', '=', 1);
  }
  const rows = await q.execute();
  return rows.map(toRssFeed);
}

export async function updateRssFeed(id: string, patch: UpdateRssFeedInput): Promise<RssFeed | undefined> {
  const db = getDatabase();
  const now = Date.now();

  const updates: Record<string, any> = { updated_at: now };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.site_url !== undefined) updates.site_url = patch.site_url;
  if (patch.pot_ids !== undefined) updates.pot_ids = JSON.stringify(patch.pot_ids);
  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.trusted !== undefined) updates.trusted = patch.trusted ? 1 : 0;
  if (patch.post_frequency !== undefined) updates.post_frequency = patch.post_frequency;
  if (patch.last_fetched_at !== undefined) updates.last_fetched_at = patch.last_fetched_at;
  if (patch.error_count !== undefined) updates.error_count = patch.error_count;
  if (Object.prototype.hasOwnProperty.call(patch, 'last_error')) updates.last_error = patch.last_error;
  if (Object.prototype.hasOwnProperty.call(patch, 'fetch_etag')) updates.fetch_etag = patch.fetch_etag;
  if (Object.prototype.hasOwnProperty.call(patch, 'fetch_modified')) updates.fetch_modified = patch.fetch_modified;

  await db.updateTable('rss_feeds').set(updates).where('id', '=', id).execute();

  return getRssFeed(id);
}

export async function deleteRssFeed(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('rss_feeds').where('id', '=', id).execute();
}

// ── Articles ──────────────────────────────────────────────────────────────

export async function upsertRssArticle(input: UpsertRssArticleInput): Promise<RssArticle> {
  const db = getDatabase();
  const now = Date.now();

  // Try to find existing article by feed_id + guid
  const existing = await db
    .selectFrom('rss_articles')
    .selectAll()
    .where('feed_id', '=', input.feed_id)
    .where('guid', '=', input.guid)
    .executeTakeFirst();

  if (existing) {
    return toRssArticle(existing);
  }

  const id = randomUUID();
  await db
    .insertInto('rss_articles')
    .values({
      id,
      feed_id: input.feed_id,
      guid: input.guid,
      title: input.title,
      url: input.url,
      author: input.author ?? null,
      summary: input.summary ?? null,
      image_url: input.image_url ?? null,
      published_at: input.published_at ?? null,
      fetched_at: now,
      pot_tags: JSON.stringify(input.pot_tags ?? []),
      is_read: 0,
      created_at: now,
    })
    .execute();

  return {
    id,
    feed_id: input.feed_id,
    guid: input.guid,
    title: input.title,
    url: input.url,
    author: input.author ?? null,
    summary: input.summary ?? null,
    image_url: input.image_url ?? null,
    published_at: input.published_at ?? null,
    fetched_at: now,
    pot_tags: input.pot_tags ?? [],
    is_read: false,
    created_at: now,
    feedback: null,
  };
}

export interface ListRssArticlesOptions {
  page?: number;
  limit?: number;
  feedId?: string;
  fromDate?: number;
  toDate?: number;
  unreadOnly?: boolean;
  feedback?: 'liked' | 'disliked' | 'hidden';
}

export async function listRssArticles(
  opts: ListRssArticlesOptions = {},
): Promise<{ articles: RssArticle[]; total: number }> {
  const db = getDatabase();
  const limit = opts.limit ?? 10;
  const offset = ((opts.page ?? 1) - 1) * limit;

  let q = db.selectFrom('rss_articles').selectAll();
  let countQ = db.selectFrom('rss_articles').select(db.fn.count<number>('id').as('count'));

  if (opts.feedId) {
    q = q.where('feed_id', '=', opts.feedId);
    countQ = countQ.where('feed_id', '=', opts.feedId);
  }
  if (opts.fromDate) {
    q = q.where('published_at', '>=', opts.fromDate);
    countQ = countQ.where('published_at', '>=', opts.fromDate);
  }
  if (opts.toDate) {
    q = q.where('published_at', '<=', opts.toDate);
    countQ = countQ.where('published_at', '<=', opts.toDate);
  }
  if (opts.unreadOnly) {
    q = q.where('is_read', '=', 0);
    countQ = countQ.where('is_read', '=', 0);
  }

  const [rows, countResult] = await Promise.all([
    q.orderBy('published_at', 'desc').limit(limit).offset(offset).execute(),
    countQ.executeTakeFirst(),
  ]);

  // Load feedback for these articles
  const articleIds = rows.map((r) => r.id);
  let feedbackMap: Record<string, 'liked' | 'disliked' | 'hidden'> = {};
  if (articleIds.length > 0) {
    const fbRows = await db
      .selectFrom('rss_article_feedback')
      .selectAll()
      .where('article_id', 'in', articleIds)
      .execute();
    for (const fb of fbRows) {
      feedbackMap[fb.article_id] = fb.feedback;
    }
  }

  // Filter by feedback if requested
  let articles = rows.map((r) => toRssArticle(r, feedbackMap[r.id] ?? null));
  if (opts.feedback) {
    articles = articles.filter((a) => a.feedback === opts.feedback);
  }

  return {
    articles,
    total: Number(countResult?.count ?? 0),
  };
}

export async function markRssArticleRead(id: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('rss_articles').set({ is_read: 1 }).where('id', '=', id).execute();
}

export async function setRssArticleFeedback(
  articleId: string,
  feedback: 'liked' | 'disliked' | 'hidden',
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();

  // Check existing
  const existing = await db
    .selectFrom('rss_article_feedback')
    .select('id')
    .where('article_id', '=', articleId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('rss_article_feedback')
      .set({ feedback })
      .where('article_id', '=', articleId)
      .execute();
  } else {
    await db
      .insertInto('rss_article_feedback')
      .values({ id: randomUUID(), article_id: articleId, feedback, created_at: now })
      .execute();
  }
}

export async function clearRssArticleFeedback(articleId: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('rss_article_feedback').where('article_id', '=', articleId).execute();
}

export async function getRssArticleFeedback(
  articleId: string,
): Promise<'liked' | 'disliked' | 'hidden' | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('rss_article_feedback')
    .select('feedback')
    .where('article_id', '=', articleId)
    .executeTakeFirst();
  return row ? row.feedback : null;
}

export async function pruneOldRssArticles(olderThanMs: number): Promise<number> {
  const db = getDatabase();
  const result = await db
    .deleteFrom('rss_articles')
    .where('fetched_at', '<', olderThanMs)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

// ── Suggestions ───────────────────────────────────────────────────────────

export async function listRssFeedSuggestions(showDismissed?: boolean): Promise<RssFeedSuggestion[]> {
  const db = getDatabase();
  let q = db.selectFrom('rss_feed_suggestions').selectAll().where('added', '=', 0);
  if (!showDismissed) {
    q = q.where('dismissed', '=', 0);
  }
  const rows = await q.orderBy('suggested_at', 'desc').execute();
  return rows.map(toRssFeedSuggestion);
}

export async function upsertRssFeedSuggestion(
  url: string,
  input: CreateRssFeedSuggestionInput,
): Promise<RssFeedSuggestion> {
  const db = getDatabase();
  const now = Date.now();

  // Check for existing suggestion with same URL
  const existing = await db
    .selectFrom('rss_feed_suggestions')
    .selectAll()
    .where('url', '=', url)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('rss_feed_suggestions')
      .set({
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        reason: input.reason ?? existing.reason,
        example_articles: JSON.stringify(input.example_articles ?? JSON.parse(existing.example_articles)),
        post_frequency: input.post_frequency ?? existing.post_frequency,
        suggested_at: now,
        dismissed: 0,
      })
      .where('url', '=', url)
      .execute();
    const updated = await db
      .selectFrom('rss_feed_suggestions')
      .selectAll()
      .where('url', '=', url)
      .executeTakeFirst();
    return toRssFeedSuggestion(updated!);
  }

  const id = randomUUID();
  await db
    .insertInto('rss_feed_suggestions')
    .values({
      id,
      url,
      title: input.title ?? null,
      description: input.description ?? null,
      reason: input.reason ?? null,
      example_articles: JSON.stringify(input.example_articles ?? []),
      post_frequency: input.post_frequency ?? null,
      suggested_at: now,
      dismissed: 0,
      added: 0,
    })
    .execute();

  return {
    id,
    url,
    title: input.title ?? null,
    description: input.description ?? null,
    reason: input.reason ?? null,
    example_articles: input.example_articles ?? [],
    post_frequency: input.post_frequency ?? null,
    suggested_at: now,
    dismissed: false,
    added: false,
  };
}

export async function dismissRssFeedSuggestion(id: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('rss_feed_suggestions').set({ dismissed: 1 }).where('id', '=', id).execute();
}

export async function markRssFeedSuggestionAdded(id: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('rss_feed_suggestions').set({ added: 1 }).where('id', '=', id).execute();
}
