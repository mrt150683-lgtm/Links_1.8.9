import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { Pot } from '@/lib/types';
import docIcon from '@/assets/icons/doc.png?url';
import imageIcon from '@/assets/icons/image.png?url';
import textIcon from '@/assets/icons/text.png?url';
import linksIcon from '@/assets/icons/logo_links.png?url';
import tagsIcon from '@/assets/icons/tags.png?url';
import entitiesIcon from '@/assets/icons/entities.png?url';
import summariesIcon from '@/assets/icons/summaries.png?url';
import generateIcon from '@/assets/icons/generate.png?url';
import './Search.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type EntryType = 'text' | 'image' | 'doc' | 'link';
type MatchType = 'content' | 'tag' | 'entity' | 'summary' | 'connection';

interface SearchResultItem {
  entry_id: string;
  type: EntryType;
  snippet: string;
  score: number;
  captured_at: number;
  source_url?: string | null;
  source_title?: string | null;
  has_asset?: boolean;
  match_type?: MatchType;
  matched_value?: string;
}

interface IntelligenceSearchResult {
  question_id: string;
  question_text: string;
  answer_text?: string | null;
  category?: string | null;
  confidence?: number | null;
  entry_ids: string[];
  match_type: 'question' | 'answer';
}

interface SearchResponse {
  q: string;
  pot_id: string;
  results: SearchResultItem[];
  intelligence_results: IntelligenceSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const TYPE_FILTERS: { value: EntryType | 'all'; label: string; icon?: string; emoji?: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'text',  label: 'Text',  icon: textIcon },
  { value: 'image', label: 'Image', icon: imageIcon },
  { value: 'doc',   label: 'Doc',   icon: docIcon },
  { value: 'link',  label: 'Link',  icon: linksIcon },
];

function entryIcon(type: EntryType): string {
  if (type === 'image') return imageIcon;
  if (type === 'doc')   return docIcon;
  if (type === 'link')  return linksIcon;
  if (type === 'text')  return textIcon;
  return docIcon;
}

function matchBadge(matchType: MatchType = 'content', matchedValue?: string) {
  const labels: Record<MatchType, string> = {
    content: 'Content',
    tag: matchedValue ?? 'Tag',
    entity: matchedValue ?? 'Entity',
    summary: 'Summary',
    connection: matchedValue ? matchedValue.replace(/_/g, ' ') : 'Connection',
  };
  const icons: Record<MatchType, string | null> = {
    content: null,
    tag: tagsIcon,
    entity: entitiesIcon,
    summary: summariesIcon,
    connection: linksIcon,
  };
  const emojis: Record<MatchType, string> = {
    content: '📄',
    tag: '',
    entity: '',
    summary: '',
    connection: '',
  };
  const icon = icons[matchType];
  return (
    <span className={`match-badge match-badge--${matchType}`}>
      {icon
        ? <img src={icon} alt={matchType} />
        : <span>{emojis[matchType]}</span>}
      {labels[matchType]}
    </span>
  );
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function confidenceColor(c: number) {
  if (c >= 0.7) return '#22c55e';
  if (c >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SearchPage() {
  const navigate = useNavigate();
  const [selectedPotId, setSelectedPotId] = useState<string>('');
  const [inputValue, setInputValue]     = useState('');
  const [query, setQuery]               = useState('');
  const [typeFilter, setTypeFilter]     = useState<EntryType | 'all'>('all');
  const [page, setPage]                 = useState(0);
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load pots for selector
  const { data: potsData } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });
  const pots = potsData?.pots ?? [];

  // Auto-select first pot
  useEffect(() => {
    if (pots.length > 0 && !selectedPotId) {
      setSelectedPotId(pots[0].id);
    }
  }, [pots, selectedPotId]);

  // Debounce input → query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(inputValue.trim());
      setPage(0);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputValue]);

  // Reset page on filter / pot change
  useEffect(() => { setPage(0); }, [typeFilter, selectedPotId]);

  const offset = page * PAGE_SIZE;

  const { data: searchData, isLoading, isFetching } = useQuery({
    queryKey: ['search', selectedPotId, query, typeFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({
        q: query,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      return api.get<SearchResponse>(`/pots/${selectedPotId}/search?${params}`);
    },
    enabled: !!selectedPotId && query.length >= 2,
    staleTime: 10000,
  });

  const results           = searchData?.results ?? [];
  const intelligenceResults = searchData?.intelligence_results ?? [];
  const total             = searchData?.total ?? 0;
  const totalPages        = Math.ceil(total / PAGE_SIZE);
  const hasResults        = results.length > 0 || intelligenceResults.length > 0;

  return (
    <div className="search-page">
      {/* Header */}
      <div className="search-page__header">
        <h1>🔍 Search</h1>
        <p>
          Search across entry content, tags, entities, summaries, connections, and generated intelligence.
        </p>
      </div>

      {/* Controls */}
      <div className="search-controls panel" style={{ padding: 'var(--space-4)' }}>
        {/* Pot selector */}
        <div className="search-controls__pot-row">
          <span className="search-controls__pot-label">Pot:</span>
          <select
            className="search-controls__pot-select"
            value={selectedPotId}
            onChange={(e) => setSelectedPotId(e.target.value)}
          >
            {pots.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Search input */}
        <div className="search-controls__input-row">
          <div className="search-controls__input-wrap">
            <span className="search-controls__icon">🔍</span>
            <input
              className="search-controls__input"
              type="text"
              placeholder="Search entries, tags, entities, connections, questions…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Type filters */}
        <div className="search-type-filters">
          <span className="search-type-filters__label">Type:</span>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`search-type-chip ${typeFilter === f.value ? 'search-type-chip--active' : ''}`}
              onClick={() => setTypeFilter(f.value as EntryType | 'all')}
            >
              {f.icon && <img src={f.icon} alt={f.label} />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* No pot available */}
      {pots.length === 0 && (
        <div className="search-empty">
          <div className="search-empty__icon">🗂️</div>
          <h3>No pots found</h3>
          <p>Create a pot first, then search its entries.</p>
        </div>
      )}

      {/* Prompt to type */}
      {pots.length > 0 && query.length < 2 && (
        <div className="search-prompt">
          <div className="search-prompt__icon">🔍</div>
          <p>Type at least 2 characters to search</p>
        </div>
      )}

      {/* Loading */}
      {query.length >= 2 && (isLoading || isFetching) && (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-2)', fontSize: '14px' }}>
          Searching…
        </div>
      )}

      {/* Results */}
      {query.length >= 2 && !isLoading && (
        <>
          {/* Meta row */}
          {hasResults && (
            <div className="search-meta">
              <span className="search-meta__count">
                {total} {total === 1 ? 'entry' : 'entries'}
                {intelligenceResults.length > 0 && ` · ${intelligenceResults.length} intelligence ${intelligenceResults.length === 1 ? 'result' : 'results'}`}
                {' '}for <strong>"{query}"</strong>
              </span>
            </div>
          )}

          {/* Empty state */}
          {!hasResults && (
            <div className="search-empty">
              <div className="search-empty__icon">🔍</div>
              <h3>No results</h3>
              <p>Nothing matched <strong>"{query}"</strong>{typeFilter !== 'all' ? ` in ${typeFilter} entries` : ''}.
                Try different keywords or remove the type filter.</p>
            </div>
          )}

          {/* Entry results */}
          {results.length > 0 && (
            <div className="search-results">
              {results.map((r) => (
                <div
                  key={r.entry_id}
                  className="search-result-card panel"
                  onClick={() => navigate(`/pots/${selectedPotId}/entries/${r.entry_id}`)}
                >
                  <div className="search-result-card__header">
                    <img
                      src={entryIcon(r.type)}
                      alt={r.type}
                      className="search-result-card__icon"
                    />
                    <div className="search-result-card__title-block">
                      <h4 className="search-result-card__title">
                        {r.source_title ?? r.source_url ?? r.entry_id.slice(0, 8) + '…'}
                      </h4>
                      <div className="search-result-card__badges">
                        {matchBadge(r.match_type, r.matched_value)}
                        <span className="badge">{r.type}</span>
                        {r.has_asset && <span className="badge">📎 asset</span>}
                      </div>
                    </div>
                  </div>

                  {r.snippet && (
                    <p className="search-result-card__snippet">{r.snippet}</p>
                  )}

                  <div className="search-result-card__meta">
                    <span>{formatDate(r.captured_at)}</span>
                    {r.source_url && (
                      <span
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}
                        title={r.source_url}
                      >
                        {r.source_url}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="search-pagination">
              <button
                className="btn-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Prev
              </button>
              <span className="search-pagination__info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="btn-secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}

          {/* Intelligence results */}
          {intelligenceResults.length > 0 && (
            <div className="search-intelligence">
              <h3 className="search-intelligence__heading">
                <img src={generateIcon} alt="Intelligence" />
                Generated Intelligence Matches
              </h3>

              {intelligenceResults.map((ir) => (
                <div key={ir.question_id} className="intel-result-card panel">
                  <div className="intel-result-card__match-row">
                    <span className={`match-badge match-badge--${ir.match_type === 'question' ? 'content' : 'summary'}`}>
                      {ir.match_type === 'question' ? '❓ Question' : '💡 Answer'}
                    </span>
                    {ir.category && (
                      <span className="badge" style={{ fontSize: '11px' }}>
                        {ir.category.replace('_', ' ')}
                      </span>
                    )}
                    {ir.confidence != null && (
                      <span style={{ fontSize: '12px', fontWeight: 600, color: confidenceColor(ir.confidence) }}>
                        {Math.round(ir.confidence * 100)}%
                      </span>
                    )}
                  </div>

                  <p className="intel-result-card__question">{ir.question_text}</p>

                  {ir.answer_text && (
                    <p className="intel-result-card__answer">{ir.answer_text}</p>
                  )}

                  {ir.entry_ids.length > 0 && (
                    <div className="intel-result-card__meta">
                      <span>
                        {ir.entry_ids.length} {ir.entry_ids.length === 1 ? 'entry' : 'entries'} involved
                      </span>
                      {ir.entry_ids.slice(0, 3).map((id) => (
                        <button
                          key={id}
                          className="btn-secondary"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                          onClick={() => navigate(`/pots/${selectedPotId}/entries/${id}`)}
                        >
                          → {id.slice(0, 8)}…
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
