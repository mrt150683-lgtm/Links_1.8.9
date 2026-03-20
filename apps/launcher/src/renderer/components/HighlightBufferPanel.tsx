/**
 * HighlightBufferPanel — Phase F
 * Panel showing accumulated text highlights waiting to be saved.
 */
import React, { useState, useEffect } from 'react';
import type { HighlightBufferEntry } from '../../shared/types.js';

interface Pot { id: string; name: string; }

const PANEL_INSET = 320;

export function HighlightBufferPanel() {
  const [buffer, setBuffer] = useState<HighlightBufferEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [pots, setPots] = useState<Pot[]>([]);
  const [selectedPotId, setSelectedPotId] = useState('');

  useEffect(() => {
    window.electronAPI.getHighlightBuffer().then(setBuffer).catch(() => { /* ignore */ });
    const unsub = window.electronAPI.onHighlightBufferChanged(setBuffer);
    return unsub;
  }, []);

  useEffect(() => {
    window.electronAPI.setTopInset(open ? PANEL_INSET : 0).catch(() => { /* ignore */ });
    return () => { if (open) window.electronAPI.setTopInset(0).catch(() => { /* ignore */ }); };
  }, [open]);

  useEffect(() => {
    if (open && pots.length === 0) {
      window.electronAPI.getPots().then((data) => {
        const list: Pot[] = (data as any).pots ?? [];
        setPots(list);
        if (list.length > 0) setSelectedPotId(list[0].id);
      }).catch(() => { /* ignore */ });
    }
  }, [open]);

  if (buffer.length === 0) return null;

  return (
    <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as never }}>
      <button
        title={`${buffer.length} highlight${buffer.length > 1 ? 's' : ''} buffered`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 30,
          height: 30,
          border: 'none',
          background: 'rgba(232,160,32,0.2)',
          color: '#e8a020',
          fontSize: 14,
          cursor: 'pointer',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          WebkitAppRegion: 'no-drag' as never,
        }}
      >
        ✂
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            background: '#e8a020',
            color: '#000',
            borderRadius: '50%',
            width: 12,
            height: 12,
            fontSize: 8,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {buffer.length > 9 ? '9+' : buffer.length}
        </span>
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
            {/* Header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#e8e8f0' }}>
                Highlight Buffer ({buffer.length})
              </span>
              {pots.length > 0 && (
                <select
                  value={selectedPotId}
                  onChange={(e) => setSelectedPotId(e.target.value)}
                  style={{
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
              )}
              <button
                onClick={async () => {
                  if (!selectedPotId) return;
                  for (const h of buffer) {
                    await window.electronAPI.saveHighlight(h.id, selectedPotId);
                  }
                  setOpen(false);
                }}
                style={{
                  background: '#4a9eff',
                  border: 'none',
                  color: '#fff',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save All
              </button>
            </div>

            {/* Buffer items */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {buffer.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#c8c8e0', marginBottom: 4, fontStyle: 'italic' }}>
                    "{h.text.slice(0, 120)}{h.text.length > 120 ? '…' : ''}"
                  </div>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.url}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => selectedPotId && window.electronAPI.saveHighlight(h.id, selectedPotId)}
                      style={{ background: 'rgba(74,158,255,0.15)', border: 'none', color: '#4a9eff', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => window.electronAPI.discardHighlight(h.id)}
                      style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, padding: '3px 8px' }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer: discard all */}
            <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => { window.electronAPI.clearHighlightBuffer(); setOpen(false); }}
                style={{ background: 'transparent', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 12 }}
              >
                Discard all
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
