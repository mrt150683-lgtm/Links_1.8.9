import React, { useState } from 'react';
import type { PotEntry, ActiveContextItem } from '../potChatTypes';
import { EntryIcon } from './EntryIcon';

interface KnowledgeBrowserProps {
  entries: PotEntry[];
  activeContext: ActiveContextItem[];
  onOpenEntry(entry: PotEntry): void;
  onAddToContext(entry: PotEntry): void;
  onRemoveFromContext(id: string): void;
}

const FILTER_TYPES = ['All', 'doc', 'image', 'audio', 'link', 'chat'] as const;

function entryMatchesQuery(entry: PotEntry, query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  if (entry.title.toLowerCase().includes(q)) return true;
  if (entry.artifacts.shortSummary.toLowerCase().includes(q)) return true;
  if (entry.artifacts.summaryBullets.some((b) => b.toLowerCase().includes(q))) return true;
  if (entry.artifacts.tags.some((t) => t.label.toLowerCase().includes(q))) return true;
  if (entry.artifacts.entities.some((en) => en.label.toLowerCase().includes(q))) return true;
  return false;
}

export const KnowledgeBrowser: React.FC<KnowledgeBrowserProps> = ({
  entries,
  activeContext,
  onOpenEntry,
  onAddToContext,
  onRemoveFromContext,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  const filtered = entries.filter((e) => {
    const matchesType = filterType === 'All' || e.type === filterType;
    const matchesSearch = entryMatchesQuery(e, searchQuery);
    return matchesType && matchesSearch;
  });

  return (
    <div>
      {/* Search */}
      <div className="pot-chat__kb-search">
        <svg className="pot-chat__kb-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search pot entries..."
          className="pot-chat__kb-input"
        />
      </div>

      {/* Type filters */}
      <div className="pot-chat__kb-filters">
        {FILTER_TYPES.map((f) => (
          <button
            key={f}
            onClick={() => setFilterType(f)}
            className={`pot-chat__kb-filter ${filterType === f ? 'pot-chat__kb-filter--active' : ''}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Entry list */}
      <div>
        {filtered.map((entry) => {
          const isActive = activeContext.some((a) => a.entry.id === entry.id);
          return (
            <div
              key={entry.id}
              className="pot-chat__kb-entry"
              onClick={() => onOpenEntry(entry)}
            >
              <div className="pot-chat__kb-entry-row">
                <div className="pot-chat__kb-entry-info">
                  <EntryIcon type={entry.type} />
                  <div style={{ minWidth: 0 }}>
                    <div className="pot-chat__kb-entry-title">{entry.title}</div>
                    <div className="pot-chat__kb-entry-summary">{entry.artifacts.shortSummary}</div>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    isActive ? onRemoveFromContext(entry.id) : onAddToContext(entry);
                  }}
                  className={`pot-chat__kb-toggle ${isActive ? 'pot-chat__kb-toggle--active' : 'pot-chat__kb-toggle--inactive'}`}
                  title={isActive ? 'Remove from context' : 'Add to context'}
                >
                  {isActive ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
