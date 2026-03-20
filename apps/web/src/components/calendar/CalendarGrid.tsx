/**
 * CalendarGrid — renders a month-level calendar grid.
 * Shows pot icon (🏺) and H icon for each date that has data.
 * Calls onClick(dateKey) when user clicks a date cell.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DateCounts {
  entry_date_counts: Record<string, number>;
  history_counts: Record<string, number>;
  events: Array<{ id: string; title: string; date_key: string; importance: number }>;
}

interface Props {
  year: number;
  month: number; // 1-12
  potId?: string;
  selectedDate?: string;
  onSelectDate: (dateKey: string) => void;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay(); // 0=Sun
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function CalendarGrid({ year, month, potId, selectedDate, onSelectDate }: Props) {
  const from = `${year}-${pad2(month)}-01`;
  const to = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;

  const { data } = useQuery<DateCounts>({
    queryKey: ['calendar-range', from, to, potId],
    queryFn: () => {
      const qs = new URLSearchParams({ from, to, include_extracted: '1', include_history: '1' });
      if (potId) qs.set('pot_id', potId);
      return api.get(`/calendar/range?${qs}`);
    },
  });

  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);
  const cells: Array<{ day: number; dateKey: string } | null> = [];

  // Leading empty cells
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, dateKey: `${year}-${pad2(month)}-${pad2(d)}` });
  }

  return (
    <div className="calendar-grid">
      <div className="calendar-grid__header">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="calendar-grid__day-name">{d}</div>
        ))}
      </div>
      <div className="calendar-grid__cells">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`empty-${idx}`} className="calendar-grid__cell calendar-grid__cell--empty" />;

          const { day, dateKey } = cell;
          const entryCount = data?.entry_date_counts[dateKey] ?? 0;
          const histCount = data?.history_counts[dateKey] ?? 0;
          const events = (data?.events ?? []).filter((e) => e.date_key === dateKey);
          const isSelected = dateKey === selectedDate;
          const isToday = dateKey === new Date().toISOString().slice(0, 10);

          return (
            <div
              key={dateKey}
              className={[
                'calendar-grid__cell',
                isSelected ? 'calendar-grid__cell--selected' : '',
                isToday ? 'calendar-grid__cell--today' : '',
              ].join(' ')}
              onClick={() => onSelectDate(dateKey)}
            >
              <span className="calendar-grid__day-num">{day}</span>
              <div className="calendar-grid__indicators">
                {entryCount > 0 && <span className="calendar-grid__indicator calendar-grid__indicator--pot" title={`${entryCount} entry dates`}>🏺</span>}
                {histCount > 0 && <span className="calendar-grid__indicator calendar-grid__indicator--h" title={`${histCount} history visits`}>H</span>}
                {events.map((e) => (
                  <span key={e.id} className="calendar-grid__event-dot" title={e.title} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
