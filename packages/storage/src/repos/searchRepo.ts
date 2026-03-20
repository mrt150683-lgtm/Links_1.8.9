/**
 * Phase 12: Search Repository
 *
 * Extended search across:
 *   - Entry content (content_text, link_url, link_title, source_url, source_title, notes)
 *   - Derived artifacts: tag labels, entity names, summary text
 *   - Connections (links): rationale + link_type
 *   - Generated intelligence: question_text, rationale, answer_text
 */

import { getDatabase } from '../db.js';
import type { SearchResultItem, IntelligenceSearchResult } from '@links/core';

interface SearchOptions {
  potId: string;
  query: string;
  limit: number;
  offset: number;
  type?: 'text' | 'image' | 'doc' | 'link';
  minConfidence?: number;
  hasAssets?: boolean;
}

/**
 * Extract a short snippet from text, centred around the first match of query.
 */
function extractSnippet(text: string, query: string, maxLength = 150): string {
  if (!text) return '';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 100);
  const snippet = text.substring(start, end);
  return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
}

/**
 * Search entries in a pot across all available data sources:
 *   1. Entry fields (content_text, link_url, link_title, source_url, source_title, notes)
 *   2. Derived artifact payloads (tag labels, entity names, summary text)
 *   3. Link rationale (connections)
 *   4. Intelligence questions and answers (returned separately)
 */
export async function searchEntries(options: SearchOptions): Promise<{
  results: SearchResultItem[];
  intelligence_results: IntelligenceSearchResult[];
  total: number;
}> {
  const db = getDatabase();
  const { potId, query, limit, offset, type, hasAssets } = options;
  const pattern = `%${query}%`;

  // ─── 1. Entry content search ───────────────────────────────────────────────
  let entryQuery = db
    .selectFrom('entries')
    .select([
      'id',
      'type',
      'content_text',
      'link_title',
      'link_url',
      'captured_at',
      'source_url',
      'source_title',
      'asset_id',
    ])
    .where('pot_id', '=', potId)
    .where((eb) =>
      eb.or([
        eb('content_text', 'like', pattern),
        eb('link_url', 'like', pattern),
        eb('link_title', 'like', pattern),
        eb('source_url', 'like', pattern),
        eb('source_title', 'like', pattern),
        eb('notes', 'like', pattern),
      ])
    );

  if (type) entryQuery = entryQuery.where('type', '=', type as any);
  if (hasAssets === true) entryQuery = entryQuery.where('asset_id', 'is not', null);
  else if (hasAssets === false) entryQuery = entryQuery.where('asset_id', 'is', null);

  const entryRows = await entryQuery.execute();

  // Map entry_id → result (deduplicate later across all sources)
  const resultMap = new Map<string, SearchResultItem>();

  for (const row of entryRows) {
    resultMap.set(row.id, {
      entry_id: row.id,
      type: row.type as SearchResultItem['type'],
      snippet: extractSnippet(
        row.content_text ?? row.link_title ?? row.link_url ?? row.source_title ?? row.source_url ?? '',
        query
      ),
      score: 1.0,
      captured_at: row.captured_at,
      source_url: row.source_url ?? undefined,
      source_title: row.source_title ?? row.link_title ?? undefined,
      has_asset: row.asset_id !== null,
      match_type: 'content',
    });
  }

  // ─── 2. Artifact search (tags, entities, summaries) ────────────────────────
  // Fetch all artifacts for this pot whose payload_json contains the query
  const artifactRows = await db
    .selectFrom('derived_artifacts as da')
    .innerJoin('entries as e', 'e.id', 'da.entry_id')
    .select([
      'da.entry_id',
      'da.artifact_type',
      'da.payload_json',
      'e.type as entry_type',
      'e.captured_at',
      'e.source_url',
      'e.source_title',
      'e.link_title',
      'e.asset_id',
    ])
    .where('da.pot_id', '=', potId)
    .where('da.payload_json', 'like', pattern)
    .execute();

  for (const row of artifactRows) {
    // Skip if we already have a content match for this entry (content wins)
    if (resultMap.has(row.entry_id)) continue;

    // Apply type filter if requested
    if (type && row.entry_type !== type) continue;
    if (hasAssets === true && row.asset_id === null) continue;
    if (hasAssets === false && row.asset_id !== null) continue;

    let matchType: SearchResultItem['match_type'] = 'summary';
    let matchedValue: string | undefined;
    let snippet = '';

    try {
      const payload = JSON.parse(row.payload_json as string);

      if (row.artifact_type === 'tags' && payload.tags) {
        const matched = (payload.tags as Array<{ label: string }>).find((t) =>
          t.label.toLowerCase().includes(query.toLowerCase())
        );
        if (matched) {
          matchType = 'tag';
          matchedValue = matched.label;
          snippet = `Tag: ${matched.label}`;
        }
      } else if (row.artifact_type === 'entities' && payload.entities) {
        const matched = (payload.entities as Array<{ label: string; type: string }>).find((e) =>
          e.label.toLowerCase().includes(query.toLowerCase())
        );
        if (matched) {
          matchType = 'entity';
          matchedValue = matched.label;
          snippet = `Entity: ${matched.label} (${matched.type})`;
        }
      } else if (row.artifact_type === 'summary' && payload.summary) {
        matchType = 'summary';
        snippet = extractSnippet(payload.summary as string, query);
      }
    } catch {
      // Malformed payload_json — skip
      continue;
    }

    if (!snippet) continue;

    resultMap.set(row.entry_id, {
      entry_id: row.entry_id,
      type: row.entry_type as SearchResultItem['type'],
      snippet,
      score: 0.9,
      captured_at: row.captured_at,
      source_url: row.source_url ?? undefined,
      source_title: row.source_title ?? row.link_title ?? undefined,
      has_asset: row.asset_id !== null,
      match_type: matchType,
      matched_value: matchedValue,
    });
  }

  // ─── 3. Connection search (links) ──────────────────────────────────────────
  // When a link's rationale or link_type matches, surface both connected entries
  const linkRows = await db
    .selectFrom('links as l')
    .innerJoin('entries as src', 'src.id', 'l.src_entry_id')
    .innerJoin('entries as dst', 'dst.id', 'l.dst_entry_id')
    .select([
      'l.src_entry_id',
      'l.dst_entry_id',
      'l.link_type',
      'l.rationale',
      'l.confidence',
      'src.type as src_type',
      'src.captured_at as src_captured_at',
      'src.source_url as src_source_url',
      'src.source_title as src_source_title',
      'src.link_title as src_link_title',
      'src.asset_id as src_asset_id',
      'dst.type as dst_type',
      'dst.captured_at as dst_captured_at',
      'dst.source_url as dst_source_url',
      'dst.source_title as dst_source_title',
      'dst.link_title as dst_link_title',
      'dst.asset_id as dst_asset_id',
    ])
    .where('l.pot_id', '=', potId)
    .where('l.rationale', 'like', pattern)
    .execute();

  for (const row of linkRows) {
    const connectionSnippet = `Connection (${row.link_type}): ${extractSnippet(row.rationale, query, 100)}`;

    if (!resultMap.has(row.src_entry_id)) {
      if (!type || row.src_type === type) {
        resultMap.set(row.src_entry_id, {
          entry_id: row.src_entry_id,
          type: row.src_type as SearchResultItem['type'],
          snippet: connectionSnippet,
          score: 0.8,
          captured_at: row.src_captured_at,
          source_url: row.src_source_url ?? undefined,
          source_title: row.src_source_title ?? row.src_link_title ?? undefined,
          has_asset: row.src_asset_id !== null,
          match_type: 'connection',
          matched_value: row.link_type,
        });
      }
    }

    if (!resultMap.has(row.dst_entry_id)) {
      if (!type || row.dst_type === type) {
        resultMap.set(row.dst_entry_id, {
          entry_id: row.dst_entry_id,
          type: row.dst_type as SearchResultItem['type'],
          snippet: connectionSnippet,
          score: 0.8,
          captured_at: row.dst_captured_at,
          source_url: row.dst_source_url ?? undefined,
          source_title: row.dst_source_title ?? row.dst_link_title ?? undefined,
          has_asset: row.dst_asset_id !== null,
          match_type: 'connection',
          matched_value: row.link_type,
        });
      }
    }
  }

  // ─── 4. Intelligence search (Q&A) ─────────────────────────────────────────
  // Returned separately — questions/answers are not entries
  const intelligenceResults: IntelligenceSearchResult[] = [];

  // 4a. Search question text + rationale
  const questionRows = await db
    .selectFrom('intelligence_questions as q')
    .leftJoin('intelligence_answers as a', 'a.question_id', 'q.id')
    .select([
      'q.id as question_id',
      'q.question_text',
      'q.category',
      'q.rationale',
      'q.entry_ids_json',
      'a.answer_text',
      'a.confidence',
    ])
    .where('q.pot_id', '=', potId)
    .where('q.status', '=', 'done')
    .where((eb) =>
      eb.or([
        eb('q.question_text', 'like', pattern),
        eb('q.rationale', 'like', pattern),
      ])
    )
    .execute();

  for (const row of questionRows) {
    let entryIds: string[] = [];
    try { entryIds = JSON.parse(row.entry_ids_json as string) ?? []; } catch { /* ignore */ }

    intelligenceResults.push({
      question_id: row.question_id,
      question_text: row.question_text,
      answer_text: row.answer_text ?? undefined,
      category: row.category ?? undefined,
      confidence: row.confidence ?? undefined,
      entry_ids: entryIds,
      match_type: 'question',
    });
  }

  // 4b. Search answer text (avoid duplicating questions already matched)
  const matchedQuestionIds = new Set(intelligenceResults.map((r) => r.question_id));

  const answerRows = await db
    .selectFrom('intelligence_answers as a')
    .innerJoin('intelligence_questions as q', 'q.id', 'a.question_id')
    .select([
      'q.id as question_id',
      'q.question_text',
      'q.category',
      'q.entry_ids_json',
      'a.answer_text',
      'a.confidence',
    ])
    .where('q.pot_id', '=', potId)
    .where('a.answer_text', 'like', pattern)
    .execute();

  for (const row of answerRows) {
    if (matchedQuestionIds.has(row.question_id)) continue;

    let entryIds: string[] = [];
    try { entryIds = JSON.parse(row.entry_ids_json as string) ?? []; } catch { /* ignore */ }

    intelligenceResults.push({
      question_id: row.question_id,
      question_text: row.question_text,
      answer_text: row.answer_text,
      category: row.category ?? undefined,
      confidence: row.confidence,
      entry_ids: entryIds,
      match_type: 'answer',
    });
  }

  // ─── Assemble final results ────────────────────────────────────────────────
  const allResults = Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score || b.captured_at - a.captured_at);

  const total = allResults.length;
  const paginated = allResults.slice(offset, offset + limit);

  return { results: paginated, intelligence_results: intelligenceResults, total };
}

/**
 * Count total searchable entries in a pot
 */
export async function countSearchableEntries(potId: string): Promise<number> {
  const db = getDatabase();
  const result = await db
    .selectFrom('entries')
    .select(db.fn.count<number>('id').as('count'))
    .where('pot_id', '=', potId)
    .executeTakeFirst();
  return result?.count ?? 0;
}
