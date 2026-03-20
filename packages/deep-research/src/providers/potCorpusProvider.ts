/**
 * PotCorpusProvider
 *
 * DB-backed corpus search using existing entries + derived artifacts.
 *
 * Search strategy:
 * 1. LIKE search on entries (content_text, source_title, link_title)
 * 2. Entity/tag overlap fallback for semantic matches
 * 3. Merge & dedupe by entry_id, score by relevance
 * 4. Build snippet: summary artifact first, then content_text (trimmed)
 */

import { getDatabase } from '@links/storage';
import type { CorpusProvider, CorpusResult } from '../types.js';

const SNIPPET_SUMMARY_MAX = 600;
const SNIPPET_CONTENT_MAX = 2000;

export class PotCorpusProvider implements CorpusProvider {
  private readonly potId: string;
  /** Entry IDs to exclude (e.g. freshly-ingested web entries not yet processed) */
  private readonly excludedEntryIds: Set<string>;

  constructor(potId: string, excludedEntryIds: Set<string> = new Set()) {
    this.potId = potId;
    this.excludedEntryIds = excludedEntryIds;
  }

  async search(query: string, topK: number): Promise<CorpusResult[]> {
    const db = getDatabase();

    // Tokenise the query into significant keywords (length > 3, skip common stop words)
    const STOP_WORDS = new Set([
      'about', 'above', 'after', 'also', 'and', 'are', 'been', 'being',
      'best', 'both', 'each', 'else', 'even', 'every', 'for', 'from',
      'have', 'here', 'how', 'into', 'its', 'just', 'like', 'more',
      'most', 'much', 'new', 'not', 'only', 'other', 'our', 'over',
      'same', 'should', 'some', 'such', 'than', 'that', 'the', 'their',
      'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
      'too', 'under', 'very', 'was', 'well', 'were', 'what', 'when',
      'where', 'which', 'while', 'who', 'will', 'with', 'you', 'your',
    ]);
    const tokens = query
      .split(/[\s\-\/\(\)\[\],;:]+/)
      .map((t) => t.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t));

    // Deduplicate tokens, keep up to 6 most significant (longest first)
    const uniqueTokens = [...new Set(tokens)]
      .sort((a, b) => b.length - a.length)
      .slice(0, 6);

    // Fall back to full-phrase match if tokenisation yields nothing
    const patterns = uniqueTokens.length > 0
      ? uniqueTokens.map((t) => `%${t}%`)
      : [`%${query}%`];

    // 1. LIKE search on entry content fields — match any token (OR), rank by count later
    const contentRows = await db
      .selectFrom('entries')
      .select(['id', 'content_text', 'content_sha256', 'source_url', 'link_title', 'source_title'])
      .where('pot_id', '=', this.potId)
      .where((eb) =>
        eb.or(
          patterns.flatMap((pat) => [
            eb('content_text', 'like', pat),
            eb('link_title', 'like', pat),
            eb('source_title', 'like', pat),
          ])
        )
      )
      .limit(topK * 4)
      .execute();

    // 2. Entity-based semantic fallback: entries whose entity payload contains query keywords
    const entityRows = await db
      .selectFrom('derived_artifacts as da')
      .innerJoin('entries as e', 'e.id', 'da.entry_id')
      .select([
        'e.id',
        'e.content_text',
        'e.content_sha256',
        'e.source_url',
        'e.link_title',
        'e.source_title',
      ])
      .where('da.pot_id', '=', this.potId)
      .where('da.artifact_type', 'in', ['entities', 'tags'])
      .where((eb) =>
        eb.or(patterns.map((pat) => eb('da.payload_json', 'like', pat)))
      )
      .limit(topK * 2)
      .execute();

    // Merge & dedupe; score by how many tokens appear in the entry (more = more relevant)
    const ranked = new Map<string, {
      id: string;
      content_text: string | null;
      content_sha256: string | null;
      source_url: string | null;
      link_title: string | null;
      source_title: string | null;
      score: number;
    }>();

    const tokenHits = (row: { content_text: string | null; link_title: string | null; source_title: string | null }): number => {
      const haystack = [row.content_text ?? '', row.link_title ?? '', row.source_title ?? '']
        .join(' ')
        .toLowerCase();
      return uniqueTokens.filter((t) => haystack.includes(t)).length;
    };

    for (const row of contentRows) {
      const hits = tokenHits(row);
      const score = uniqueTokens.length > 0 ? hits / uniqueTokens.length : 1.0;
      if (!ranked.has(row.id)) {
        ranked.set(row.id, { ...row, score });
      } else {
        const existing = ranked.get(row.id)!;
        if (score > existing.score) existing.score = score;
      }
    }
    for (const row of entityRows) {
      if (!ranked.has(row.id)) {
        ranked.set(row.id, { ...row, score: 0.5 });
      }
    }

    // Sort by score, limit to topK
    const sortedEntries = Array.from(ranked.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 3. Load summary artifacts for top entries to enrich snippets
    if (sortedEntries.length === 0) return [];

    const entryIds = sortedEntries.map((e) => e.id);
    const summaryRows = await db
      .selectFrom('derived_artifacts')
      .select(['entry_id', 'payload_json'])
      .where('entry_id', 'in', entryIds)
      .where('artifact_type', '=', 'summary')
      .orderBy('created_at', 'desc')
      .execute();

    const summaryByEntryId = new Map<string, string>();
    for (const row of summaryRows) {
      if (!summaryByEntryId.has(row.entry_id)) {
        try {
          const payload = JSON.parse(row.payload_json as string);
          if (payload.summary && typeof payload.summary === 'string') {
            summaryByEntryId.set(row.entry_id, payload.summary);
          }
        } catch { /* skip malformed */ }
      }
    }

    // 4. Build results, excluding blacklisted entries
    const results: CorpusResult[] = [];
    for (const entry of sortedEntries) {
      if (this.excludedEntryIds.has(entry.id)) continue;

      const summaryText = summaryByEntryId.get(entry.id) ?? '';
      const contentText = entry.content_text ?? '';

      const snippet = [
        summaryText.substring(0, SNIPPET_SUMMARY_MAX),
        contentText.substring(0, SNIPPET_CONTENT_MAX),
      ]
        .filter(Boolean)
        .join('\n\n---\n\n');

      results.push({
        entry_id: entry.id,
        content: snippet || `[entry ${entry.id}]`,
        source_label: entry.source_url ?? entry.link_title ?? `entry:${entry.id}`,
        sha256: entry.content_sha256 ?? '',
      });
    }

    return results;
  }

  /**
   * Mark an entry ID as excluded (e.g. just-ingested web entry still being processed)
   */
  exclude(entryId: string): void {
    this.excludedEntryIds.add(entryId);
  }

  /**
   * Remove exclusion (e.g. after pipeline completes for web entry)
   */
  include(entryId: string): void {
    this.excludedEntryIds.delete(entryId);
  }
}
