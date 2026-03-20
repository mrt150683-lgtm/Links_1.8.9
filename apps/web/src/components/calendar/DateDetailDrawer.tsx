/**
 * DateDetailDrawer — shows events, entry_dates, and history for a selected date.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface CalendarEvent {
  id: string;
  title: string;
  details: string | null;
  start_at: number;
  end_at: number | null;
  all_day: boolean;
  importance: number;
  pot_id: string | null;
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

interface HistoryItem {
  id: string;
  url: string;
  title: string | null;
  visit_time: number;
}

interface DateDetail {
  events: CalendarEvent[];
  entry_dates: CalendarEntryDate[];
  history: HistoryItem[];
}

interface Props {
  dateKey: string;
  potId?: string;
  onClose?: () => void;
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function DateDetailDrawer({ dateKey, potId, onClose }: Props) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<DateDetail>({
    queryKey: ['calendar-date', dateKey, potId],
    queryFn: () => {
      const qs = potId ? `?pot_id=${potId}` : '';
      return api.get(`/calendar/date/${dateKey}${qs}`);
    },
  });

  return (
    <div className="date-detail-drawer">
      <div className="date-detail-drawer__header">
        <h3 className="date-detail-drawer__title">{dateKey}</h3>
        {onClose && (
          <button className="date-detail-drawer__close" onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>

      {isLoading && <div className="date-detail-drawer__loading">Loading…</div>}

      {data && (
        <div className="date-detail-drawer__content">
          {/* Events */}
          {data.events.length > 0 && (
            <section className="date-detail-drawer__section">
              <h4 className="date-detail-drawer__section-title">Events</h4>
              {data.events.map((e) => (
                <div key={e.id} className="date-detail-drawer__event">
                  <div className="date-detail-drawer__event-title">{e.title}</div>
                  {!e.all_day && (
                    <div className="date-detail-drawer__event-time">{formatTime(e.start_at)}</div>
                  )}
                  {e.details && (
                    <div className="date-detail-drawer__event-details">{e.details.substring(0, 200)}</div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Entry dates */}
          {data.entry_dates.length > 0 && (
            <section className="date-detail-drawer__section">
              <h4 className="date-detail-drawer__section-title">Linked Entries</h4>
              {data.entry_dates.map((ed) => (
                <div key={ed.id} className="date-detail-drawer__entry-date">
                  <div className="date-detail-drawer__entry-label">
                    {ed.label ?? `Entry (${ed.source_kind})`}
                    {ed.confidence !== null && (
                      <span className="date-detail-drawer__entry-confidence">
                        {` — ${Math.round(ed.confidence * 100)}%`}
                      </span>
                    )}
                  </div>
                  <button
                    className="date-detail-drawer__open-btn"
                    onClick={() => navigate(`/pots/${ed.pot_id}/entries/${ed.entry_id}`)}
                  >
                    Open
                  </button>
                </div>
              ))}
            </section>
          )}

          {/* History */}
          {data.history.length > 0 && (
            <section className="date-detail-drawer__section">
              <h4 className="date-detail-drawer__section-title">History</h4>
              {data.history.slice(0, 20).map((h) => (
                <div key={h.id} className="date-detail-drawer__history-item">
                  <span className="date-detail-drawer__history-title">
                    {h.title ?? new URL(h.url).hostname}
                  </span>
                  <span className="date-detail-drawer__history-time">
                    {new Date(h.visit_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </section>
          )}

          {data.events.length === 0 && data.entry_dates.length === 0 && data.history.length === 0 && (
            <div className="date-detail-drawer__empty">No items for this date.</div>
          )}
        </div>
      )}
    </div>
  );
}
