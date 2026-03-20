/**
 * SessionPanel — Phase J
 * Save and restore named browser sessions.
 */
import React, { useState, useEffect } from 'react';
import type { BrowserSession } from '../../shared/types.js';

const PANEL_INSET = 320;

export function SessionPanel() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    window.electronAPI.setTopInset(open ? PANEL_INSET : 0).catch(() => { /* ignore */ });
    return () => { if (open) window.electronAPI.setTopInset(0).catch(() => { /* ignore */ }); };
  }, [open]);

  const loadSessions = () => {
    window.electronAPI.getSessions().then(setSessions).catch(() => { /* ignore */ });
  };

  useEffect(() => {
    if (open) loadSessions();
  }, [open]);

  const handleSave = async () => {
    const name = newName.trim() || `Session ${new Date().toLocaleDateString()}`;
    setSaving(true);
    await window.electronAPI.saveSession(name);
    setNewName('');
    setSaving(false);
    loadSessions();
  };

  return (
    <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as never }}>
      <button
        title="Sessions"
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
        🗂
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
              width: 300,
              maxHeight: 400,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8f0', marginBottom: 8 }}>
                Sessions
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  placeholder="Session name…"
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
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: '#4a9eff',
                    border: 'none',
                    color: '#fff',
                    padding: '5px 10px',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Save
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {sessions.length === 0 ? (
                <div style={{ padding: 16, color: '#555', fontSize: 12, textAlign: 'center' }}>
                  No saved sessions
                </div>
              ) : (
                sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    onRestore={() => {
                      window.electronAPI.restoreSession(s.id);
                      setOpen(false);
                    }}
                    onDelete={() => {
                      window.electronAPI.deleteSession(s.id);
                      loadSessions();
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SessionRow({
  session,
  onRestore,
  onDelete,
}: {
  session: BrowserSession;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name}
        </div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
          {session.tabSnapshot?.length ?? 0} tabs •{' '}
          {new Date(session.createdAt).toLocaleDateString()}
        </div>
      </div>
      <button
        onClick={onRestore}
        style={{ background: 'rgba(74,158,255,0.15)', border: 'none', color: '#4a9eff', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
      >
        Restore
      </button>
      <button
        onClick={onDelete}
        style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '3px 5px' }}
      >
        ✕
      </button>
    </div>
  );
}
