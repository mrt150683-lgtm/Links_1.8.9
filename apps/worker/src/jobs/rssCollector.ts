/**
 * rss_collector Job Handler
 *
 * Fetches all enabled RSS feeds, parses articles, deduplicates by guid,
 * stores new articles, and prunes old articles based on retention_days setting.
 *
 * Payload: { force?: boolean }
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  listRssFeeds,
  updateRssFeed,
  upsertRssArticle,
  pruneOldRssArticles,
  getRssSettings,
  logAuditEvent,
} from '@links/storage';
import Parser from 'rss-parser';

const logger = createLogger({ name: 'job:rss-collector' });

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Links-RSS-Reader/1.0',
  },
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
    ],
  },
});

export async function rssCollectorHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'RSS collector started' });

  const settings = await getRssSettings();
  const feeds = await listRssFeeds(true); // enabled only

  logger.info({ job_id: ctx.jobId, feed_count: feeds.length, msg: 'Fetching RSS feeds' });

  let totalFetched = 0;
  let totalAdded = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    try {
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'Links-RSS-Reader/1.0',
      };
      if (feed.fetch_etag) fetchHeaders['If-None-Match'] = feed.fetch_etag;
      if (feed.fetch_modified) fetchHeaders['If-Modified-Since'] = feed.fetch_modified;

      let parsed: Awaited<ReturnType<typeof parser.parseURL>>;
      try {
        parsed = await parser.parseURL(feed.url);
      } catch (fetchErr: any) {
        // Handle 304 Not Modified gracefully
        if (fetchErr?.message?.includes('304')) {
          logger.info({ job_id: ctx.jobId, feed_id: feed.id, msg: 'Feed not modified (304)' });
          await updateRssFeed(feed.id, { last_fetched_at: Date.now(), error_count: 0, last_error: null });
          continue;
        }
        throw fetchErr;
      }

      let added = 0;
      for (const item of parsed.items ?? []) {
        if (!item.title || !item.link) continue;

        const anyItem = item as any;
        const guid = item.guid ?? anyItem.id ?? item.link;
        const publishedAt = item.pubDate ? new Date(item.pubDate).getTime() : undefined;

        // Extract image URL from various RSS/Atom sources
        const imageUrl = extractImageUrl(anyItem);

        const article = await upsertRssArticle({
          feed_id: feed.id,
          guid,
          title: item.title,
          url: item.link,
          author: anyItem.creator ?? anyItem.author ?? undefined,
          summary: item.contentSnippet ?? anyItem.summary ?? undefined,
          image_url: imageUrl,
          published_at: publishedAt,
        });

        if (article.fetched_at >= Date.now() - 5000) {
          // Newly inserted (fetched_at close to now)
          added++;
        }
      }

      totalFetched++;
      totalAdded += added;

      // Update feed metadata
      await updateRssFeed(feed.id, {
        last_fetched_at: Date.now(),
        error_count: 0,
        last_error: null,
        post_frequency: detectFrequency(parsed.items ?? []),
      });

      logger.info({
        job_id: ctx.jobId,
        feed_id: feed.id,
        feed_title: feed.title,
        added,
        msg: 'Feed fetched',
      });
    } catch (err: any) {
      totalErrors++;
      const errorMsg = err?.message ?? String(err);
      logger.error({
        job_id: ctx.jobId,
        feed_id: feed.id,
        feed_url: feed.url,
        error: errorMsg,
        msg: 'Failed to fetch feed',
      });
      await updateRssFeed(feed.id, {
        error_count: feed.error_count + 1,
        last_error: errorMsg,
      });
    }
  }

  // Prune old articles
  const retentionMs = Date.now() - settings.retention_days * 24 * 60 * 60 * 1000;
  const pruned = await pruneOldRssArticles(retentionMs);

  logger.info({
    job_id: ctx.jobId,
    feeds_fetched: totalFetched,
    feeds_errored: totalErrors,
    articles_added: totalAdded,
    articles_pruned: pruned,
    msg: 'RSS collection complete',
  });

  await logAuditEvent({
    actor: 'system',
    action: 'rss_collected',
    metadata: {
      feeds_fetched: totalFetched,
      feeds_errored: totalErrors,
      articles_added: totalAdded,
      articles_pruned: pruned,
    },
  });
}

/**
 * Estimate posting frequency based on recent item timestamps.
 */
function detectFrequency(
  items: Array<{ pubDate?: string }>,
): 'daily' | 'weekly' | 'irregular' | undefined {
  if (items.length < 2) return undefined;

  const dates = items
    .slice(0, 10)
    .map((i) => (i.pubDate ? new Date(i.pubDate).getTime() : null))
    .filter((d): d is number => d !== null)
    .sort((a, b) => b - a);

  if (dates.length < 2) return undefined;

  const gaps: number[] = [];
  for (let i = 0; i < dates.length - 1; i++) {
    gaps.push(dates[i]! - dates[i + 1]!);
  }

  const avgGapMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const avgGapDays = avgGapMs / (1000 * 60 * 60 * 24);

  if (avgGapDays <= 1.5) return 'daily';
  if (avgGapDays <= 8) return 'weekly';
  return 'irregular';
}

/**
 * Extract the best image URL from an RSS/Atom item.
 * Checks: enclosure, media:thumbnail, media:content, og:image in content:encoded.
 */
function extractImageUrl(item: any): string | undefined {
  // 1. Enclosure (podcasts, media feeds)
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
    return item.enclosure.url;
  }

  // 2. media:thumbnail (common in Atom/media-rich feeds)
  const thumb = item.mediaThumbnail;
  if (thumb) {
    const url = typeof thumb === 'string' ? thumb : thumb?.$?.url ?? thumb?.url;
    if (url) return url;
  }

  // 3. media:content with image type
  const media = item.mediaContent;
  if (media) {
    const url = typeof media === 'string' ? media : media?.$?.url ?? media?.url;
    const type = media?.$?.medium ?? media?.$?.type ?? '';
    if (url && (!type || type === 'image' || type.startsWith('image/'))) return url;
  }

  // 4. First <img> in content:encoded or content
  const html = item.contentEncoded ?? item['content:encoded'] ?? item.content ?? '';
  if (typeof html === 'string') {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1] && match[1].startsWith('http')) return match[1];
  }

  return undefined;
}
