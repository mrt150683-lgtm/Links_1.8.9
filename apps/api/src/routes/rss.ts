/**
 * RSS Feed Module Routes
 *
 * Endpoints:
 *   GET  /rss/settings
 *   PATCH /rss/settings
 *   GET  /rss/feeds
 *   POST /rss/feeds
 *   PATCH /rss/feeds/:id
 *   DELETE /rss/feeds/:id
 *   GET  /rss/articles
 *   POST /rss/articles/:id/feedback
 *   DELETE /rss/articles/:id/feedback
 *   POST /rss/articles/:id/read
 *   POST /rss/discover
 *   GET  /rss/suggestions
 *   POST /rss/suggestions/:id/add
 *   POST /rss/suggestions/:id/dismiss
 *   POST /rss/collect
 *
 * Migration: 038_rss.sql
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getRssSettings,
  updateRssSettings,
  listRssFeeds,
  createRssFeed,
  getRssFeed,
  getRssFeedByUrl,
  updateRssFeed,
  deleteRssFeed,
  listRssArticles,
  markRssArticleRead,
  setRssArticleFeedback,
  clearRssArticleFeedback,
  listRssFeedSuggestions,
  upsertRssFeedSuggestion,
  dismissRssFeedSuggestion,
  markRssFeedSuggestionAdded,
  enqueueJob,
  getAIPreferences,
  logAuditEvent,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile, interpolatePrompt } from '@links/ai';
import { RssDiscoverResultSchema } from '@links/core';
import { createLogger } from '@links/logging';
import Parser from 'rss-parser';

const logger = createLogger({ name: 'rss-routes' });

const rssParser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'Links-RSS-Reader/1.0' },
});

// ── Prompt helper ─────────────────────────────────────────────────────────

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  const { join, dirname } = require('node:path');
  try {
    return join(dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

// ── Validation Schemas ────────────────────────────────────────────────────

const RssSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  collect_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  articles_per_page: z.number().int().min(5).max(50).optional(),
  retention_days: z.number().int().min(7).max(365).optional(),
});

const CreateFeedBodySchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  pot_ids: z.array(z.string()).optional(),
  trusted: z.boolean().optional(),
});

const UpdateFeedBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  pot_ids: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  trusted: z.boolean().optional(),
});

const FeedbackBodySchema = z.object({
  feedback: z.enum(['liked', 'disliked', 'hidden']),
});

const DiscoverBodySchema = z.object({
  query: z.string().min(1).max(500),
  pot_context: z.string().max(1000).optional(),
});

// ── Route Plugin ──────────────────────────────────────────────────────────

export const rssRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /rss/settings ─────────────────────────────────────────────────

  fastify.get('/rss/settings', async (_request, reply) => {
    const settings = await getRssSettings();
    return reply.send(settings);
  });

  // ── PATCH /rss/settings ───────────────────────────────────────────────

  fastify.patch<{ Body: unknown }>('/rss/settings', async (request, reply) => {
    const parsed = RssSettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: parsed.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }
    const updated = await updateRssSettings(parsed.data);
    return reply.send(updated);
  });

  // ── GET /rss/feeds ────────────────────────────────────────────────────

  fastify.get('/rss/feeds', async (_request, reply) => {
    const feeds = await listRssFeeds();
    return reply.send({ feeds });
  });

  // ── POST /rss/feeds ───────────────────────────────────────────────────

  fastify.post<{ Body: unknown }>('/rss/feeds', async (request, reply) => {
    const parsed = CreateFeedBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: parsed.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { url, title, description, pot_ids, trusted } = parsed.data;

    // Check if feed already exists
    const existing = await getRssFeedByUrl(url);
    if (existing) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'A feed with this URL already exists',
        feed: existing,
        statusCode: 409,
        request_id: request.id,
      });
    }

    // Fetch feed to get metadata if title not provided
    let feedTitle = title ?? url;
    let feedDescription = description;
    let feedSiteUrl: string | undefined;

    try {
      const fetchedFeed = await rssParser.parseURL(url);
      feedTitle = title ?? fetchedFeed.title ?? url;
      feedDescription = description ?? fetchedFeed.description ?? undefined;
      feedSiteUrl = fetchedFeed.link ?? undefined;
    } catch (err) {
      logger.warn({ url, err: String(err), msg: 'Failed to fetch feed for metadata' });
      // Continue with provided or fallback values
    }

    const feed = await createRssFeed({
      url,
      title: feedTitle,
      description: feedDescription,
      site_url: feedSiteUrl,
      pot_ids: pot_ids ?? [],
      trusted: trusted ?? false,
    });

    logger.info({ request_id: request.id, feed_id: feed.id, url, msg: 'RSS feed created' });

    await logAuditEvent({
      actor: 'user',
      action: 'rss_feed_created',
      metadata: { feed_id: feed.id, url },
    });

    // Enqueue an immediate collection for this feed
    await enqueueJob({
      job_type: 'rss_collector',
      payload: { feed_ids: [feed.id] },
      priority: 25,
    });

    return reply.status(201).send(feed);
  });

  // ── PATCH /rss/feeds/:id ──────────────────────────────────────────────

  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/rss/feeds/:id',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = UpdateFeedBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: parsed.error.message,
          statusCode: 400,
          request_id: request.id,
        });
      }

      const existing = await getRssFeed(id);
      if (!existing) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feed not found', statusCode: 404 });
      }

      const updated = await updateRssFeed(id, parsed.data);
      return reply.send(updated);
    },
  );

  // ── DELETE /rss/feeds/:id ─────────────────────────────────────────────

  fastify.delete<{ Params: { id: string } }>('/rss/feeds/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await getRssFeed(id);
    if (!existing) {
      return reply.status(404).send({ error: 'NotFound', message: 'Feed not found', statusCode: 404 });
    }
    await deleteRssFeed(id);
    logger.info({ request_id: request.id, feed_id: id, msg: 'RSS feed deleted' });
    return reply.status(204).send();
  });

  // ── GET /rss/articles ─────────────────────────────────────────────────

  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      feedId?: string;
      fromDate?: string;
      toDate?: string;
      unreadOnly?: string;
      feedback?: string;
    };
  }>('/rss/articles', async (request, reply) => {
    const { page, limit, feedId, fromDate, toDate, unreadOnly, feedback } = request.query;

    const result = await listRssArticles({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      feedId,
      fromDate: fromDate ? parseInt(fromDate, 10) : undefined,
      toDate: toDate ? parseInt(toDate, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
      feedback: feedback as 'liked' | 'disliked' | 'hidden' | undefined,
    });

    return reply.send(result);
  });

  // ── POST /rss/articles/:id/feedback ──────────────────────────────────

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/rss/articles/:id/feedback',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = FeedbackBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: parsed.error.message,
          statusCode: 400,
          request_id: request.id,
        });
      }
      await setRssArticleFeedback(id, parsed.data.feedback);
      return reply.send({ success: true });
    },
  );

  // ── DELETE /rss/articles/:id/feedback ────────────────────────────────

  fastify.delete<{ Params: { id: string } }>(
    '/rss/articles/:id/feedback',
    async (request, reply) => {
      const { id } = request.params;
      await clearRssArticleFeedback(id);
      return reply.send({ success: true });
    },
  );

  // ── POST /rss/articles/:id/read ───────────────────────────────────────

  fastify.post<{ Params: { id: string } }>('/rss/articles/:id/read', async (request, reply) => {
    const { id } = request.params;
    await markRssArticleRead(id);
    return reply.send({ success: true });
  });

  // ── POST /rss/discover ────────────────────────────────────────────────

  fastify.post<{ Body: unknown }>('/rss/discover', async (request, reply) => {
    const parsed = DiscoverBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: parsed.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { query, pot_context } = parsed.data;

    logger.info({ request_id: request.id, query, msg: 'Starting RSS feed discovery' });

    const aiPrefs = await getAIPreferences();
    const modelId =
      aiPrefs.rss_models?.feed_discovery ??
      aiPrefs.default_model ??
      'google/gemini-2.5-flash';

    // Load prompt
    let systemPrompt: string;
    let userMessage: string;
    try {
      const promptTemplate = loadPromptFromFile(
        require('node:path').join(getPromptsDir(), 'rss_feed_discovery', 'v1.md'),
      );
      const interpolated = interpolatePrompt(promptTemplate, {
        query,
        pot_context: pot_context ?? '',
      });
      systemPrompt = interpolated.system;
      userMessage = interpolated.user;
    } catch {
      // Fallback inline prompt
      systemPrompt =
        'You are an expert at finding high-quality RSS feeds. ' +
        'Respond only with a valid JSON object matching the schema provided.';
      userMessage =
        `Find 10-15 high-quality RSS feeds for the topic: "${query}"\n` +
        (pot_context ? `Context: ${pot_context}\n` : '') +
        '\nRespond with a JSON object:\n' +
        '{\n' +
        '  "keywords": ["keyword1", "keyword2"],\n' +
        '  "feeds": [\n' +
        '    {\n' +
        '      "url": "https://example.com/feed",\n' +
        '      "title": "Feed Title",\n' +
        '      "description": "What this feed covers",\n' +
        '      "estimated_frequency": "daily",\n' +
        '      "example_titles": ["Article 1", "Article 2"]\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        'Only include reputable, well-known sources. ' +
        'estimated_frequency must be daily, weekly, or irregular.';
    }

    let aiResult: { keywords: string[]; feeds: any[] };
    try {
      const aiResponse = await createChatCompletion(
        {
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        },
        90_000,
      );
      const rawText = aiResponse.choices?.[0]?.message?.content ?? '{}';
      const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      const parsed2 = JSON.parse(cleaned);

      // Use safeParse and filter out any individual feed items that fail validation
      const validation = RssDiscoverResultSchema.safeParse(parsed2);
      if (validation.success) {
        aiResult = validation.data;
      } else {
        // Fall back: extract what we can from raw parsed data
        const rawFeeds: any[] = Array.isArray(parsed2?.feeds) ? parsed2.feeds : [];
        const keywords: string[] = Array.isArray(parsed2?.keywords) ? parsed2.keywords : [];
        const validFeeds = rawFeeds
          .filter((f) => typeof f?.url === 'string' && f.url.startsWith('http'))
          .map((f) => ({ url: f.url, title: f.title ?? f.url, description: f.description ?? undefined, estimated_frequency: undefined, example_titles: Array.isArray(f.example_titles) ? f.example_titles : [] }));
        aiResult = { keywords, feeds: validFeeds };
        logger.warn({ request_id: request.id, err: validation.error.message, msg: 'AI output failed strict validation, using fallback extraction' });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ request_id: request.id, err: errMsg, msg: 'AI discovery failed' });
      return reply.status(502).send({ error: `Feed discovery failed: ${errMsg}` });
    }

    // Verify candidates by fetching them
    const existingFeeds = await listRssFeeds();
    const existingUrls = new Set(existingFeeds.map((f) => f.url));

    const verifyResults = await Promise.allSettled(
      aiResult.feeds.map(async (candidate) => {
        let verified = false;
        let resolvedTitle = candidate.title;
        let resolvedDescription = candidate.description ?? null;
        let resolvedSiteUrl: string | null = null;
        let exampleArticles: string[] = candidate.example_titles ?? [];

        try {
          const feed = await rssParser.parseURL(candidate.url);
          verified = true;
          resolvedTitle = candidate.title || feed.title || candidate.url;
          resolvedDescription = candidate.description ?? feed.description ?? null;
          resolvedSiteUrl = feed.link ?? null;
          if (feed.items && feed.items.length > 0) {
            exampleArticles = feed.items
              .slice(0, 5)
              .map((i) => i.title ?? '')
              .filter(Boolean);
          }
        } catch {
          // Not verified but still include in results
        }

        // Upsert as suggestion
        try {
          await upsertRssFeedSuggestion(candidate.url, {
            title: resolvedTitle,
            description: resolvedDescription ?? undefined,
            reason: `Discovered via topic search: "${query}"`,
            example_articles: exampleArticles,
            post_frequency: candidate.estimated_frequency,
          });
        } catch {
          // Non-fatal
        }

        return {
          url: candidate.url,
          title: resolvedTitle,
          description: resolvedDescription,
          site_url: resolvedSiteUrl,
          example_articles: exampleArticles,
          post_frequency: candidate.estimated_frequency ?? null,
          verified,
          already_following: existingUrls.has(candidate.url),
        };
      }),
    );

    const discoveredFeeds = verifyResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

    logger.info({
      request_id: request.id,
      query,
      total: discoveredFeeds.length,
      verified: discoveredFeeds.filter((f) => f.verified).length,
      msg: 'RSS discovery complete',
    });

    return reply.send({
      query,
      keywords: aiResult.keywords,
      feeds: discoveredFeeds,
    });
  });

  // ── GET /rss/suggestions ──────────────────────────────────────────────

  fastify.get<{ Querystring: { show_dismissed?: string } }>(
    '/rss/suggestions',
    async (request, reply) => {
      const showDismissed = request.query.show_dismissed === 'true';
      const suggestions = await listRssFeedSuggestions(showDismissed);
      return reply.send({ suggestions });
    },
  );

  // ── POST /rss/suggestions/:id/add ────────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    '/rss/suggestions/:id/add',
    async (request, reply) => {
      const { id } = request.params;
      const suggestions = await listRssFeedSuggestions(true);
      const suggestion = suggestions.find((s) => s.id === id);
      if (!suggestion) {
        return reply.status(404).send({ error: 'NotFound', message: 'Suggestion not found', statusCode: 404 });
      }

      // Check if already following
      const existing = await getRssFeedByUrl(suggestion.url);
      if (existing) {
        await markRssFeedSuggestionAdded(id);
        return reply.send({ feed: existing, already_existed: true });
      }

      const feed = await createRssFeed({
        url: suggestion.url,
        title: suggestion.title ?? suggestion.url,
        description: suggestion.description ?? undefined,
        user_added: false,
      });

      await markRssFeedSuggestionAdded(id);

      // Enqueue collection
      await enqueueJob({
        job_type: 'rss_collector',
        payload: { feed_ids: [feed.id] },
        priority: 25,
      });

      logger.info({ request_id: request.id, feed_id: feed.id, suggestion_id: id, msg: 'Suggestion added as feed' });

      return reply.status(201).send({ feed, already_existed: false });
    },
  );

  // ── POST /rss/suggestions/:id/dismiss ────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    '/rss/suggestions/:id/dismiss',
    async (request, reply) => {
      const { id } = request.params;
      await dismissRssFeedSuggestion(id);
      return reply.send({ success: true });
    },
  );

  // ── POST /rss/collect ─────────────────────────────────────────────────

  fastify.post('/rss/collect', async (request, reply) => {
    await enqueueJob({
      job_type: 'rss_collector',
      payload: { force: true },
      priority: 30,
    });
    logger.info({ request_id: request.id, msg: 'Manual RSS collection triggered' });
    return reply.send({ success: true, message: 'Collection job enqueued' });
  });
};
