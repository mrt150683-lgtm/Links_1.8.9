/**
 * HistoryPanel — Phase K
 * Searchable browsing history panel.
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { HistoryEntry } from '../../shared/types.js';

interface Pot { id: string; name: string; }

const PANEL_INSET = 320;

export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [pots, setPots] = useState<Pot[]>([]);

  const loadHistory = useCallback((q?: string) => {
    window.electronAPI.getHistory(q, 80).then(setHistory).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    window.electronAPI.setTopInset(open ? PANEL_INSET : 0).catch(() => { /* ignore */ });
    return () => { if (open) window.electronAPI.setTopInset(0).catch(() => { /* ignore */ }); };
  }, [open]);

  useEffect(() => {
    if (open) {
      loadHistory();
      window.electronAPI.getPots().then((data: any) => {
        setPots((data as any).pots ?? []);
      }).catch(() => { /* ignore */ });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => loadHistory(query || undefined), 300);
    return () => clearTimeout(timer);
  }, [query, open]);

  return (
    <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as never }}>
      <button
        title="History"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 30,
          height: 30,
          border: 'none',
          background: open ? 'rgba(74,158,255,0.2)' : 'transparent',
          color: open ? '#4a9eff' : '#aaa',
          fontSize: 14,
          cursor: 'pointer',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          WebkitAppRegion: 'no-drag' as never,
        }}
      >
        🕐
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 100,
              background: '#1e1e2e',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              width: 360,
              maxHeight: 480,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header + search */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search history…"
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 4,
                  color: '#e8e8f0',
                  fontSize: 12,
                  padding: '5px 8px',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => { window.electronAPI.clearHistory(); setHistory([]); }}
                title="Clear all history"
                style={{ background: 'transparent', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11 }}
              >
                Clear
              </button>
            </div>

            {/* History list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {history.length === 0 ? (
                <div style={{ padding: 16, color: '#555', fontSize: 12, textAlign: 'center' }}>
                  {query ? 'No matches' : 'No history yet'}
                </div>
              ) : (
                history.map((h) => (
                  <HistoryRow key={h.id} entry={h} pots={pots} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HistoryRow({ entry, pots }: { entry: HistoryEntry; pots: Pot[] }) {
  const [showPromote, setShowPromote] = useState(false);
  const [selectedPotId, setSelectedPotId] = useState(pots[0]?.id ?? '');

  const timeStr = new Date(entry.visitTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      style={{
        padding: '7px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={() => window.electronAPI.newTab(entry.url)}
            style={{
              fontSize: 12,
              color: '#c8c8e0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {entry.title || entry.url}
          </div>
          <div style={{ fontSize: 10, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {entry.url} · {timeStr}
          </div>
        </div>
        <button
          onClick={() => setShowPromote((v) => !v)}
          title="Save to Links"
          style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: '2px 5px' }}
        >
          📌
        </button>
      </div>

      {showPromote && pots.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <select
            value={selectedPotId}
            onChange={(e) => setSelectedPotId(e.target.value)}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              color: '#e8e8f0',
              fontSize: 11,
              padding: '3px 6px',
              cursor: 'pointer',
            }}
          >
            {pots.map((p) => (
              <option key={p.id} value={p.id} style={{ background: '#1e1e2e' }}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              window.electronAPI.promoteHistory(entry.id, selectedPotId);
              setShowPromote(false);
            }}
            style={{ background: '#4a9eff', border: 'none', color: '#fff', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
          >
            Save
          </button>
          <button
            onClick={() => setShowPromote(false)}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
