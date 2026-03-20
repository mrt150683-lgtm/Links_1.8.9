/**
 * CalendarPage — full-page calendar with day/week/month views.
 */

import { useState } from 'react';
import { CalendarGrid } from '@/components/calendar/CalendarGrid';
import { DateDetailDrawer } from '@/components/calendar/DateDetailDrawer';
import { EventEditorModal } from '@/components/calendar/EventEditorModal';
import './Calendar.css';

type View = 'month';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [_view, _setView] = useState<View>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(today.toISOString().slice(0, 10));
  const [showEditor, setShowEditor] = useState(false);

  function goToPrev() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }

  function goToNext() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  function goToToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setSelectedDate(now.toISOString().slice(0, 10));
  }

  return (
    <div className="calendar-page">
      <div className="calendar-page__toolbar">
        <div className="calendar-page__nav">
          <button className="btn btn--ghost" onClick={goToPrev}>‹</button>
          <span className="calendar-page__month-label">{MONTHS[month - 1]} {year}</span>
          <button className="btn btn--ghost" onClick={goToNext}>›</button>
          <button className="btn btn--ghost" onClick={goToToday}>Today</button>
        </div>
        <button className="btn btn--primary" onClick={() => setShowEditor(true)}>+ Event</button>
      </div>

      <div className="calendar-page__body">
        <div className="calendar-page__grid-area">
          <CalendarGrid
            year={year}
            month={month}
            selectedDate={selectedDate ?? undefined}
            onSelectDate={setSelectedDate}
          />
        </div>

        {selectedDate && (
          <div className="calendar-page__detail-area">
            <DateDetailDrawer
              dateKey={selectedDate}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        )}
      </div>

      {showEditor && (
        <EventEditorModal
          initialDate={selectedDate ?? undefined}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
