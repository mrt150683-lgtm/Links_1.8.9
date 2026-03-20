/**
 * MultiSourceSearchService
 *
 * Active web search using DuckDuckGo HTML and ArXiv Atom API.
 * No API keys required for either source.
 *
 * Design:
 * - Both sources queried concurrently via Promise.allSettled
 * - Any source failure returns [] for that source (fails open)
 * - Results deduplicated by URL, capped at topK
 * - 8s fetch timeout per request
 */

import { createLogger } from '@links/logging';
import type { WebSearchProvider, WebSearchResult } from '../types.js';

const logger = createLogger({ name: 'deep-research:multi-source-search' });

const FETCH_TIMEOUT_MS = 8000;
const DDG_MAX = 8;
const ARXIV_MAX = 5;

export class MultiSourceSearchService implements WebSearchProvider {
  async search(query: string, topK: number): Promise<WebSearchResult[]> {
    const [ddgResult, arxivResult] = await Promise.allSettled([
      this.searchDuckDuckGo(query),
      this.searchArxiv(query),
    ]);

    const combined: WebSearchResult[] = [
      ...(ddgResult.status === 'fulfilled' ? ddgResult.value : []),
      ...(arxivResult.status === 'fulfilled' ? arxivResult.value : []),
    ];

    if (ddgResult.status === 'rejected') {
      logger.warn({ query, error: String(ddgResult.reason), msg: 'DuckDuckGo search failed' });
    }
    if (arxivResult.status === 'rejected') {
      logger.warn({ query, error: String(arxivResult.reason), msg: 'ArXiv search failed' });
    }

    // Deduplicate by URL, cap at topK
    const seen = new Set<string>();
    return combined.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, topK);
  }

  private async searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      html = await this.fetchWithTimeout(url, {
        'User-Agent': 'LinksResearchAgent/1.0',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html',
      });
    } catch (err) {
      logger.debug({ query, error: String(err), msg: 'DuckDuckGo fetch failed' });
      return [];
    }

    const results: WebSearchResult[] = [];

    // Extract result links: <a class="result__a" href="...">title</a>
    const linkPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    // Extract snippets: <a class="result__snippet" ...>snippet</a>
    const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkPattern.exec(html)) !== null && links.length < DDG_MAX) {
      const rawUrl = linkMatch[1] ?? '';
      const rawTitleHtml = linkMatch[2] ?? '';
      const rawTitle = rawTitleHtml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
      if (!rawUrl || rawUrl.startsWith('//duckduckgo') || rawUrl.startsWith('/')) continue;
      links.push({ url: rawUrl, title: rawTitle });
    }

    const snippets: string[] = [];
    let snippetMatch: RegExpExecArray | null;
    while ((snippetMatch = snippetPattern.exec(html)) !== null) {
      const raw = (snippetMatch[1] ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').trim();
      snippets.push(raw);
    }

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!link) continue;
      results.push({
        url: link.url,
        title: link.title || link.url,
        snippet: snippets[i] ?? '',
        source_engine: 'duckduckgo',
      });
    }

    logger.debug({ query, count: results.length, msg: 'DuckDuckGo results' });
    return results;
  }

  private async searchArxiv(query: string): Promise<WebSearchResult[]> {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${ARXIV_MAX}&sortBy=lastUpdatedDate`;

    let xml: string;
    try {
      xml = await this.fetchWithTimeout(url, {
        'User-Agent': 'LinksResearchAgent/1.0',
        'Accept': 'application/atom+xml',
      });
    } catch (err) {
      logger.debug({ query, error: String(err), msg: 'ArXiv fetch failed' });
      return [];
    }

    const results: WebSearchResult[] = [];

    // Parse <entry> blocks from Atom XML
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/gi;
    let entryMatch: RegExpExecArray | null;

    while ((entryMatch = entryPattern.exec(xml)) !== null && results.length < ARXIV_MAX) {
      const entry = entryMatch[1] ?? '';

      // Extract title
      const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(entry);
      const title = (titleMatch?.[1] ?? '').trim().replace(/\s+/g, ' ');

      // Extract abstract link (rel="alternate")
      const linkMatchAlt = /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i.exec(entry)
        ?? /<link[^>]+href="([^"]+)"[^>]+rel="alternate"/i.exec(entry);
      const entryUrl = (linkMatchAlt?.[1] ?? '').trim();

      // Extract summary
      const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(entry);
      const snippet = (summaryMatch?.[1] ?? '').trim().replace(/\s+/g, ' ').substring(0, 400);

      if (!entryUrl) continue;

      results.push({
        url: entryUrl,
        title: title || entryUrl,
        snippet,
        source_engine: 'arxiv',
      });
    }

    logger.debug({ query, count: results.length, msg: 'ArXiv results' });
    return results;
  }

  private async fetchWithTimeout(url: string, headers: Record<string, string> = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LinksResearchAgent/1.0', ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
}
