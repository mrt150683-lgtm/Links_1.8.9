import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JournalEntry, JournalKind } from '@/lib/types';
import './Journal.css';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function offsetDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekEndFromDate(ymd: string): string {
  // End of the week containing this date (Sunday end)
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const day = date.getUTCDay(); // 0=Sun, 6=Sat
  const toSunday = day === 0 ? 0 : 7 - day;
  date.setUTCDate(date.getUTCDate() + toSunday);
  return date.toISOString().slice(0, 10);
}

function weekStartFromEnd(endYmd: string): string {
  const [y, m, d] = endYmd.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() - 6);
  return date.toISOString().slice(0, 10);
}

function monthYmFromDate(ymd: string): string {
  return ymd.slice(0, 7);
}

function quarterFromDate(ymd: string): { year: number; q: number } {
  const m = parseInt(ymd.slice(5, 7), 10);
  const year = parseInt(ymd.slice(0, 4), 10);
  return { year, q: Math.ceil(m / 3) };
}

function yearFromDate(ymd: string): number {
  return parseInt(ymd.slice(0, 4), 10);
}

function formatPeriodLabel(kind: JournalKind, date: string): string {
  switch (kind) {
    case 'daily':
      return new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    case 'weekly': {
      const start = weekStartFromEnd(date);
      return `Week of ${new Date(start + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
    }
    case 'monthly': {
      const [y, m] = date.split('-');
      return new Date(`${y}-${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    case 'quarterly': {
      const { year, q } = quarterFromDate(date);
      return `Q${q} ${year}`;
    }
    case 'yearly':
      return `${yearFromDate(date)}`;
  }
}

function buildQueryParams(kind: JournalKind, date: string, scopeType: 'global' | 'pot', potId?: string): string {
  const base = scopeType === 'pot' ? `/pots/${potId}/journal` : '/journal';
  switch (kind) {
    case 'daily': return `${base}/daily?date=${date}`;
    case 'weekly': return `${base}/weekly?end=${date}`;
    case 'monthly': return `${base}/monthly?month=${monthYmFromDate(date)}`;
    case 'quarterly': {
      const { year, q } = quarterFromDate(date);
      return `${base}/quarterly?year=${year}&q=${q}`;
    }
    case 'yearly': return `${base}/yearly?year=${yearFromDate(date)}`;
  }
}

function prevDate(kind: JournalKind, date: string): string {
  switch (kind) {
    case 'daily': return offsetDay(date, -1);
    case 'weekly': return offsetDay(date, -7);
    case 'monthly': {
      const [y, m] = date.split('-').map(Number);
      const prev = new Date(Date.UTC(y!, m! - 1, 1));
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      return prev.toISOString().slice(0, 10);
    }
    case 'quarterly': {
      const { year, q } = quarterFromDate(date);
      const prevQ = q === 1 ? 4 : q - 1;
      const prevYear = q === 1 ? year - 1 : year;
      return `${prevYear}-${String((prevQ - 1) * 3 + 1).padStart(2, '0')}-01`;
    }
    case 'yearly':
      return `${yearFromDate(date) - 1}-01-01`;
  }
}

function nextDate(kind: JournalKind, date: string): string {
  switch (kind) {
    case 'daily': return offsetDay(date, 1);
    case 'weekly': return offsetDay(date, 7);
    case 'monthly': {
      const [y, m] = date.split('-').map(Number);
      const next = new Date(Date.UTC(y!, m! - 1, 1));
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next.toISOString().slice(0, 10);
    }
    case 'quarterly': {
      const { year, q } = quarterFromDate(date);
      const nextQ = q === 4 ? 1 : q + 1;
      const nextYear = q === 4 ? year + 1 : year;
      return `${nextYear}-${String((nextQ - 1) * 3 + 1).padStart(2, '0')}-01`;
    }
    case 'yearly':
      return `${yearFromDate(date) + 1}-01-01`;
  }
}

function isToday(kind: JournalKind, date: string): boolean {
  const today = todayYmd();
  switch (kind) {
    case 'daily': return date === today;
    case 'weekly': return weekEndFromDate(today) === date;
    case 'monthly': return monthYmFromDate(today) === monthYmFromDate(date);
    case 'quarterly': {
      const a = quarterFromDate(today);
      const b = quarterFromDate(date);
      return a.year === b.year && a.q === b.q;
    }
    case 'yearly': return yearFromDate(today) === yearFromDate(date);
  }
}

// ---------------------------------------------------------------------------
// Note content renderers
// ---------------------------------------------------------------------------

function DailyNoteContent({ content }: { content: Record<string, unknown> }) {
  const bullets = content['what_happened'] as Array<{ bullet: string }> | undefined;
  const openLoops = content['open_loops'] as Array<{ item: string; type: string }> | undefined;
  const keyTags = content['key_tags'] as Array<{ label: string }> | undefined;
  const keyEntities = content['key_entities'] as Array<{ name: string; type: string }> | undefined;
  const stats = content['stats'] as { entries_total?: number } | undefined;

  return (
    <div className="journal-note">
      {!!content['headline'] && (
        <p className="journal-note__headline">{String(content['headline'])}</p>
      )}

      {bullets && bullets.length > 0 && (
        <div className="journal-note__section">
          <h4 className="journal-note__section-title">What Happened</h4>
          <ul className="journal-note__bullets">
            {bullets.map((b, i) => (
              <li key={i}>{b.bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {openLoops && openLoops.length > 0 && (
        <div className="journal-note__section">
          <h4 className="journal-note__section-title">Open Loops</h4>
          <ul className="journal-note__bullets journal-note__bullets--loops">
            {openLoops.map((l, i) => (
              <li key={i}>
                <span className="journal-note__loop-type">{l.type}</span>
                {l.item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="journal-note__footer">
        {keyTags && keyTags.length > 0 && (
          <div className="journal-note__tags">
            {keyTags.map((t, i) => (
              <span key={i} className="badge">{t.label}</span>
            ))}
          </div>
        )}
        {keyEntities && keyEntities.length > 0 && (
          <div className="journal-note__entities">
            {keyEntities.slice(0, 6).map((e, i) => (
              <span key={i} className="badge badge--entity">{e.name}</span>
            ))}
          </div>
        )}
        {stats?.entries_total != null && (
          <p className="journal-note__stats text-muted">
            {stats.entries_total} {stats.entries_total === 1 ? 'entry' : 'entries'} processed
          </p>
        )}
      </div>
    </div>
  );
}

function RollupNoteContent({ content }: { content: Record<string, unknown> }) {
  const bullets = content['key_developments'] as Array<{ bullet: string }> | undefined;
  const themes = content['themes'] as Array<{ theme: string }> | undefined;
  const inputs = content['inputs'] as { child_count?: number; child_kind?: string } | undefined;

  return (
    <div className="journal-note">
      {!!content['summary'] && (
        <p className="journal-note__headline">{String(content['summary'])}</p>
      )}

      {bullets && bullets.length > 0 && (
        <div className="journal-note__section">
          <h4 className="journal-note__section-title">Key Developments</h4>
          <ul className="journal-note__bullets">
            {bullets.map((b, i) => (
              <li key={i}>{b.bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {themes && themes.length > 0 && (
        <div className="journal-note__section">
          <h4 className="journal-note__section-title">Themes</h4>
          <div className="journal-note__tags">
            {themes.map((t, i) => (
              <span key={i} className="badge">{t.theme}</span>
            ))}
          </div>
        </div>
      )}

      {inputs?.child_count != null && (
        <p className="journal-note__stats text-muted">
          Synthesised from {inputs.child_count} {inputs.child_kind ?? 'child'} note{inputs.child_count !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

function NoteContent({ entry }: { entry: JournalEntry }) {
  if (entry.kind === 'daily') {
    return <DailyNoteContent content={entry.content} />;
  }
  return <RollupNoteContent content={entry.content} />;
}

// ---------------------------------------------------------------------------
// Main JournalViewer component (reused by page and PotDetail tab)
// ---------------------------------------------------------------------------

interface JournalViewerProps {
  scopeType: 'global' | 'pot';
  potId?: string;
}

export function JournalViewer({ scopeType, potId }: JournalViewerProps) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<JournalKind>('daily');
  const [date, setDate] = useState<string>(() => {
    // For weekly, default to current week's end (Sunday)
    return todayYmd();
  });
  const [pollingForRebuild, setPollingForRebuild] = useState(false);
  const [rebuildAt, setRebuildAt] = useState<number | null>(null);

  const queryUrl = buildQueryParams(kind, date, scopeType, potId);
  const queryKey = ['journal', scopeType, potId ?? 'global', kind, date];

  const { data: entry, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => api.get<JournalEntry>(queryUrl).catch((err) => {
      if (err?.statusCode === 404) return null;
      throw err;
    }),
    retry: false,
    refetchInterval: pollingForRebuild ? 3000 : false,
  });

  // Stop polling once we receive a note that was generated after the rebuild was queued
  useEffect(() => {
    if (pollingForRebuild && rebuildAt && entry) {
      const entryTime = new Date(entry.created_at).getTime();
      if (entryTime > rebuildAt) {
        setPollingForRebuild(false);
      }
    }
  }, [entry, pollingForRebuild, rebuildAt]);

  // Safety: stop polling after 90 seconds regardless
  useEffect(() => {
    if (!pollingForRebuild) return;
    const timer = setTimeout(() => setPollingForRebuild(false), 90_000);
    return () => clearTimeout(timer);
  }, [pollingForRebuild]);

  // Reset polling when the user navigates to a different period
  useEffect(() => {
    setPollingForRebuild(false);
    setRebuildAt(null);
  }, [kind, date]);

  const rebuild = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        kind,
        scope_type: scopeType,
        period_start_ymd: kind === 'daily' ? date : undefined,
        date_ymd: kind === 'daily' ? date : undefined,
        timezone: 'UTC',
      };
      if (scopeType === 'pot') payload['scope_id'] = potId;
      // For weekly, period_start_ymd is the Monday
      if (kind === 'weekly') {
        payload['period_start_ymd'] = weekStartFromEnd(date);
        payload['period_end_ymd'] = date;
        delete payload['date_ymd'];
      } else if (kind === 'monthly') {
        const [y, m] = date.split('-');
        payload['period_start_ymd'] = `${y}-${m}-01`;
      } else if (kind === 'quarterly') {
        const { year, q } = quarterFromDate(date);
        const startMonth = (q - 1) * 3 + 1;
        payload['period_start_ymd'] = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      } else if (kind === 'yearly') {
        payload['period_start_ymd'] = `${yearFromDate(date)}-01-01`;
      }
      return api.post<{ job_id: string; job_type: string }>('/journal/rebuild', payload);
    },
    onSuccess: () => {
      setRebuildAt(Date.now());
      setPollingForRebuild(true);
      // Kick off an initial check after 3 seconds
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 3000);
    },
  });

  const atToday = isToday(kind, date);

  const handleKindChange = (newKind: JournalKind) => {
    setKind(newKind);
    // Reset date anchor to today when switching kinds
    setDate(todayYmd());
  };

  const label = formatPeriodLabel(kind, date);

  return (
    <div className="journal-viewer">
      {/* Period kind tabs */}
      <div className="journal-viewer__kinds">
        {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as JournalKind[]).map((k) => (
          <button
            key={k}
            className={`journal-kind-btn ${kind === k ? 'journal-kind-btn--active' : ''}`}
            onClick={() => handleKindChange(k)}
          >
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {/* Date navigation */}
      <div className="journal-viewer__nav">
        <button className="journal-nav-btn" onClick={() => setDate(prevDate(kind, date))} title="Previous">
          ‹
        </button>
        <div className="journal-viewer__period-label">
          <span>{label}</span>
          {atToday && <span className="journal-viewer__today-badge">Today</span>}
        </div>
        <button
          className="journal-nav-btn"
          onClick={() => setDate(nextDate(kind, date))}
          disabled={atToday}
          title="Next"
        >
          ›
        </button>

        <button
          className="btn-secondary journal-viewer__rebuild-btn"
          onClick={() => rebuild.mutate()}
          disabled={rebuild.isPending}
          title="Request a fresh journal note for this period"
        >
          {rebuild.isPending ? 'Queued…' : rebuild.isSuccess ? '✓ Queued' : '↻ Rebuild'}
        </button>
      </div>

      {rebuild.isSuccess && (
        <div className="journal-viewer__rebuild-notice">
          {pollingForRebuild
            ? 'Job queued — waiting for the worker to generate the note…'
            : 'Note updated.'}
        </div>
      )}

      {/* Content area */}
      <div className="journal-viewer__content">
        {isLoading && (
          <div>
            <div className="skeleton" style={{ height: '28px', marginBottom: '12px', width: '60%' }} />
            <div className="skeleton" style={{ height: '16px', marginBottom: '8px' }} />
            <div className="skeleton" style={{ height: '16px', marginBottom: '8px', width: '80%' }} />
            <div className="skeleton" style={{ height: '16px', width: '70%' }} />
          </div>
        )}

        {!isLoading && isError && (
          <div className="journal-viewer__empty">
            <p>Failed to load journal note.</p>
          </div>
        )}

        {!isLoading && !isError && !entry && (
          <div className="journal-viewer__empty">
            <p className="journal-viewer__empty-title">No {kind} note for this period.</p>
            <p className="text-muted">
              Click <strong>↻ Rebuild</strong> to queue a generation job, then start the worker.
            </p>
          </div>
        )}

        {!isLoading && !isError && entry && (
          <>
            <div className="journal-viewer__meta text-muted">
              Generated {new Date(entry.created_at).toLocaleString()} · {entry.model_id} · {entry.prompt_id}
            </div>
            <NoteContent entry={entry} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level page (global scope)
// ---------------------------------------------------------------------------

export function JournalPage() {
  return (
    <div className="journal-page">
      <div className="journal-page__header">
        <h1>Journal</h1>
        <p className="text-muted">AI-synthesised daily, weekly, and periodic notes across all your research.</p>
      </div>
      <div className="journal-page__viewer panel">
        <JournalViewer scopeType="global" />
      </div>
    </div>
  );
}
