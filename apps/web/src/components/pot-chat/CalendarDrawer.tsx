/**
 * CalendarDrawer — PotChat right-panel tab showing calendar context.
 * Three sections: Upcoming (14 days, pot-scoped), On this date, Search.
 * "Attach" adds the linked entry to active chat context.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface CalendarEvent {
  id: string;
  title: string;
  details: string | null;
  start_at: number;
  all_day: boolean;
  importance: number;
  date_key: string;
}

interface CalendarEntryDate {
  id: string;
  entry_id: string;
  pot_id: string;
  date_key: string;
  source_kind: 'capture_date' | 'extracted_date';
  label: string | null;
  confidence: number | null;
}

interface DateDetail {
  events: CalendarEvent[];
  entry_dates: CalendarEntryDate[];
}

interface DateCounts {
  entry_date_counts: Record<string, number>;
  history_counts: Record<string, number>;
  events: Array<{ id: string; title: string; date_key: string; importance: number }>;
}

interface SearchResult {
  events: CalendarEvent[];
  entry_dates: CalendarEntryDate[];
}

interface Props {
  potId: string;
  onAttachEntry: (entryId: string) => void;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function futureDateKey(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateKey(dateKey: string): string {
  const [y, m, day] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CalendarDrawer({ potId, onAttachEntry }: Props) {
  const from = todayKey();
  const to = futureDateKey(13);

  const [onThisDate, setOnThisDate] = useState(from);
  const [searchQ, setSearchQ] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // Upcoming: next 14 days, pot-scoped
  const upcomingQuery = useQuery<DateCounts>({
    queryKey: ['cal-drawer-upcoming', potId, from, to],
    queryFn: () => {
      const qs = new URLSearchParams({ from, to, include_extracted: '1', pot_id: potId });
      return api.get(`/calendar/range?${qs}`);
    },
  });

  // On this date, pot-scoped
  const dateQuery = useQuery<DateDetail>({
    queryKey: ['cal-drawer-date', onThisDate, potId],
    queryFn: () => api.get(`/calendar/date/${onThisDate}?pot_id=${potId}`),
  });

  // Search
  const searchQuery = useQuery<SearchResult>({
    queryKey: ['cal-drawer-search', activeSearch, potId],
    queryFn: () => {
      const qs = new URLSearchParams({ q: activeSearch, pot_id: potId });
      return api.get(`/calendar/search?${qs}`);
    },
    enabled: activeSearch.length >= 2,
  });

  const upcomingEvents = upcomingQuery.data?.events ?? [];

  return (
    <div className="cal-drawer">

      {/* Upcoming */}
      <section className="cal-drawer__section">
        <h4 className="cal-drawer__section-title">Upcoming (14 days)</h4>
        {upcomingQuery.isLoading && <div className="cal-drawer__status">Loading…</div>}
        {!upcomingQuery.isLoading && upcomingEvents.length === 0 && (
          <div className="cal-drawer__status">No upcoming events.</div>
        )}
        {upcomingEvents.map((ev) => (
          <div key={ev.id} className="cal-drawer__item">
            <div className="cal-drawer__item-main">
              <span className="cal-drawer__item-label">{ev.title}</span>
              <span className="cal-drawer__item-sub">{formatDateKey(ev.date_key)}</span>
            </div>
          </div>
        ))}
      </section>

      {/* On this date */}
      <section className="cal-drawer__section">
        <h4 className="cal-drawer__section-title">On this date</h4>
        <input
          type="date"
          className="cal-drawer__date-input"
          value={onThisDate}
          onChange={(e) => setOnThisDate(e.target.value)}
        />
        {dateQuery.isLoading && <div className="cal-drawer__status">Loading…</div>}
        {dateQuery.data && (
          <>
            {dateQuery.data.events.map((ev) => (
              <div key={ev.id} className="cal-drawer__item">
                <div className="cal-drawer__item-main">
                  <span className="cal-drawer__item-label">{ev.title}</span>
                  {!ev.all_day && (
                    <span className="cal-drawer__item-sub">{formatTime(ev.start_at)}</span>
                  )}
                </div>
              </div>
            ))}
            {dateQuery.data.entry_dates.map((ed) => (
              <div key={ed.id} className="cal-drawer__item">
                <div className="cal-drawer__item-main">
                  <span className="cal-drawer__item-label">
                    {ed.label ?? `Entry (${ed.source_kind})`}
                  </span>
                  {ed.confidence !== null && (
                    <span className="cal-drawer__item-sub">
                      {Math.round(ed.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                <button
                  className="cal-drawer__attach-btn"
                  onClick={() => onAttachEntry(ed.entry_id)}
                  title="Add linked entry to active context"
                >
                  Attach
                </button>
              </div>
            ))}
            {dateQuery.data.events.length === 0 && dateQuery.data.entry_dates.length === 0 && (
              <div className="cal-drawer__status">Nothing on this date.</div>
            )}
          </>
        )}
      </section>

      {/* Search */}
      <section className="cal-drawer__section">
        <h4 className="cal-drawer__section-title">Search</h4>
        <div className="cal-drawer__search-row">
          <input
            type="text"
            className="cal-drawer__search-input"
            placeholder="Search calendar…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQ.trim().length >= 2) setActiveSearch(searchQ.trim());
            }}
          />
          <button
            className="cal-drawer__search-go"
            onClick={() => setActiveSearch(searchQ.trim())}
            disabled={searchQ.trim().length < 2}
          >
            Go
          </button>
        </div>
        {searchQuery.isLoading && <div className="cal-drawer__status">Searching…</div>}
        {searchQuery.data && (
          <>
            {searchQuery.data.events.map((ev) => (
              <div key={ev.id} className="cal-drawer__item">
                <div className="cal-drawer__item-main">
                  <span className="cal-drawer__item-label">{ev.title}</span>
                  <span className="cal-drawer__item-sub">{formatDateKey(ev.date_key)}</span>
                </div>
              </div>
            ))}
            {searchQuery.data.entry_dates.map((ed) => (
              <div key={ed.id} className="cal-drawer__item">
                <div className="cal-drawer__item-main">
                  <span className="cal-drawer__item-label">
                    {ed.label ?? `Entry (${ed.source_kind})`}
                  </span>
                  <span className="cal-drawer__item-sub">{formatDateKey(ed.date_key)}</span>
                </div>
                <button
                  className="cal-drawer__attach-btn"
                  onClick={() => onAttachEntry(ed.entry_id)}
                  title="Add linked entry to active context"
                >
                  Attach
                </button>
              </div>
            ))}
            {activeSearch.length >= 2 &&
             searchQuery.data.events.length === 0 &&
             searchQuery.data.entry_dates.length === 0 && (
              <div className="cal-drawer__status">No results for "{activeSearch}".</div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
