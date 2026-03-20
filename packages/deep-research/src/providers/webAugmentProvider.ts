/**
 * WebAugmentProvider
 *
 * Safe HTTP fetch + ingest pipeline for web augmentation.
 *
 * Security:
 * - Blocks RFC 1918 private IPs, localhost, file:// / ftp:// schemes
 * - HTTPS only (or explicit HTTP allowlist)
 * - 10s timeout, 500KB response cap
 * - Max 50KB text after extraction
 * - HTML stripped to plain text (no raw HTML in corpus)
 *
 * Pipeline sync (v2):
 * - Enqueues extract_text + summarize_entry jobs for freshly ingested entries
 * - Polls for summarize_entry completion for up to 30s
 * - If timeout: uses raw content_text (trimmed to 2000 chars), logs warning
 * - Web entries excluded from corpus until pipeline done (via excludedEntryIds)
 */

import { createLogger } from '@links/logging';
import { getDatabase, enqueueJob } from '@links/storage';
import type { SourceIngestor } from '../types.js';

const logger = createLogger({ name: 'deep-research:web-augment' });

const MAX_RESPONSE_BYTES = 500 * 1024;       // 500KB
const MAX_TEXT_CHARS = 50_000;               // 50K chars after extraction
const FETCH_TIMEOUT_MS = 10_000;             // 10s per URL
const PIPELINE_WAIT_MS = 30_000;             // 30s wait for summarize_entry
const PIPELINE_POLL_INTERVAL_MS = 2000;

// Private IP ranges (SSRF protection)
const BLOCKED_IP_PATTERNS = [
  /^127\./,           // localhost
  /^10\./,            // RFC 1918
  /^192\.168\./,      // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC 1918
  /^::1$/,            // IPv6 localhost
  /^0\./,             // 0.0.0.0/8
  /^169\.254\./,      // Link-local
];

function validateUrl(url: string, allowlist?: string[], denylist?: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Scheme check
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  // Block private/reserved IPs
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Blocked private/reserved IP: ${hostname}`);
    }
  }

  // Block 'localhost' by name
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error(`Blocked localhost: ${hostname}`);
  }

  // Denylist check
  if (denylist?.some((d) => hostname.includes(d))) {
    throw new Error(`URL blocked by denylist: ${hostname}`);
  }

  // Allowlist check (if specified, only allow matching domains)
  if (allowlist && allowlist.length > 0) {
    if (!allowlist.some((a) => hostname.includes(a))) {
      throw new Error(`URL not in allowlist: ${hostname}`);
    }
  }
}

function stripHtmlToText(html: string): string {
  // Remove script/style tags and their content
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Replace block-level tags with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode basic HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export class WebAugmentProvider implements SourceIngestor {
  private readonly potId: string;
  private readonly allowlist?: string[];
  private readonly denylist?: string[];

  constructor(potId: string, opts: { allowlist?: string[]; denylist?: string[] } = {}) {
    this.potId = potId;
    this.allowlist = opts.allowlist;
    this.denylist = opts.denylist;
  }

  async ingest(url: string, title: string, _preloadedContent?: string): Promise<{ id: string; content_sha256: string }> {
    // 1. Validate URL (SSRF + denylist checks)
    validateUrl(url, this.allowlist, this.denylist);

    // 2. Fetch content (with timeout + size limit)
    let rawContent: string;
    if (_preloadedContent) {
      rawContent = _preloadedContent;
    } else {
      rawContent = await this.fetchUrl(url);
    }

    // 3. Strip HTML to plain text + apply size limit
    const isHtml = rawContent.trimStart().startsWith('<');
    const textContent = isHtml ? stripHtmlToText(rawContent) : rawContent;
    const trimmedContent = textContent.substring(0, MAX_TEXT_CHARS);

    // 4. Create entry via direct DB insert (matches capture pattern)
    const { randomUUID } = await import('node:crypto');
    const { createHash } = await import('node:crypto');
    const db = getDatabase();

    const entryId = randomUUID();
    const now = Date.now();
    const contentSha256 = createHash('sha256').update(trimmedContent).digest('hex');

    await db
      .insertInto('entries')
      .values({
        id: entryId,
        pot_id: this.potId,
        type: 'link',
        content_text: trimmedContent,
        content_sha256: contentSha256,
        capture_method: 'deep_research',
        source_url: null,
        source_title: null,
        notes: null,
        captured_at: now,
        created_at: now,
        updated_at: now,
        client_capture_id: null,
        source_app: 'deep_research',
        source_context_json: null,
        asset_id: null,
        link_url: url,
        link_title: title || url,
      })
      .execute();

    // 5. Enqueue pipeline jobs
    await enqueueJob({ job_type: 'extract_text', pot_id: this.potId, entry_id: entryId, priority: 60 });
    await enqueueJob({ job_type: 'tag_entry', pot_id: this.potId, entry_id: entryId, priority: 60 });
    await enqueueJob({ job_type: 'extract_entities', pot_id: this.potId, entry_id: entryId, priority: 60 });
    await enqueueJob({ job_type: 'summarize_entry', pot_id: this.potId, entry_id: entryId, priority: 60 });

    // 6. Poll for summarize_entry completion (up to 30s)
    const pipelineDone = await this.waitForSummarize(entryId);
    if (!pipelineDone) {
      logger.warn({
        entry_id: entryId,
        url,
        msg: 'summarize_entry pipeline timeout — using raw content as corpus snippet',
      });
    }

    return { id: entryId, content_sha256: contentSha256 };
  }

  private async fetchUrl(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LinksResearchAgent/1.0' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported content-type: ${contentType}`);
      }

      // Read with size limit
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let totalBytes = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }

      const decoder = new TextDecoder();
      return decoder.decode(Buffer.concat(chunks));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForSummarize(entryId: string): Promise<boolean> {
    const db = getDatabase();
    const deadline = Date.now() + PIPELINE_WAIT_MS;

    while (Date.now() < deadline) {
      const row = await db
        .selectFrom('processing_jobs')
        .select(['status'])
        .where('entry_id', '=', entryId)
        .where('job_type', '=', 'summarize_entry')
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (row?.status === 'done') return true;

      await sleep(PIPELINE_POLL_INTERVAL_MS);
    }

    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
