/**
 * EventEditorModal — create or edit a calendar event.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Props {
  onClose: () => void;
  initialDate?: string; // YYYY-MM-DD pre-fill
  eventId?: string;     // If set, edit mode
  initialValues?: {
    title: string;
    details?: string;
    start_at: number;
    all_day: boolean;
    importance: number;
    pot_id?: string;
  };
}

export function EventEditorModal({ onClose, initialDate, eventId, initialValues }: Props) {
  const qc = useQueryClient();
  const isEdit = !!eventId;

  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [details, setDetails] = useState(initialValues?.details ?? '');
  const [dateStr, setDateStr] = useState(
    initialDate ?? (initialValues ? new Date(initialValues.start_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
  );
  const [timeStr, setTimeStr] = useState('09:00');
  const [allDay, setAllDay] = useState(initialValues?.all_day ?? false);
  const [importance, setImportance] = useState(initialValues?.importance ?? 1);

  const mutation = useMutation({
    mutationFn: async () => {
      const start_at = allDay
        ? new Date(dateStr + 'T00:00:00').getTime()
        : new Date(dateStr + 'T' + timeStr + ':00').getTime();

      const body = { title, details: details || undefined, start_at, all_day: allDay, importance };

      if (isEdit) {
        return api.patch(`/calendar/events/${eventId}`, body);
      } else {
        return api.post('/calendar/events', body);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-range'] });
      qc.invalidateQueries({ queryKey: ['calendar-date'] });
      onClose();
    },
  });

  return (
    <div className="event-editor-overlay" onClick={onClose}>
      <div className="event-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-editor-modal__header">
          <h3>{isEdit ? 'Edit Event' : 'New Event'}</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="event-editor-modal__body">
          <label className="event-editor-modal__field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              autoFocus
            />
          </label>

          <label className="event-editor-modal__field">
            <span>Details</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="Optional details…"
            />
          </label>

          <label className="event-editor-modal__field">
            <span>Date</span>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </label>

          <label className="event-editor-modal__field event-editor-modal__field--inline">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span>All day</span>
          </label>

          {!allDay && (
            <label className="event-editor-modal__field">
              <span>Time</span>
              <input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            </label>
          )}

          <label className="event-editor-modal__field">
            <span>Importance</span>
            <select value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
              <option value={1}>Low</option>
              <option value={50}>Medium</option>
              <option value={100}>High</option>
            </select>
          </label>
        </div>

        {mutation.isError && (
          <div className="event-editor-modal__error">Failed to save event.</div>
        )}

        <div className="event-editor-modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => mutation.mutate()}
            disabled={!title.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
