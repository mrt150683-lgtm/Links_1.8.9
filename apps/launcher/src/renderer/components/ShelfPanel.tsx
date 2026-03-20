/**
 * ShelfPanel — Phase B
 * Slide-in panel showing shelved (parked) tabs.
 */
import React, { useState, useEffect } from 'react';
import type { ShelfItem, TabGroup } from '../../shared/types.js';

interface Props {
  groups: TabGroup[];
}

const PANEL_INSET = 320;

export function ShelfPanel({ groups }: Props) {
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [open, setOpen] = useState(false);

  // Push the WebContentsView down while open so the dropdown isn't hidden behind it
  useEffect(() => {
    window.electronAPI.setTopInset(open ? PANEL_INSET : 0).catch(() => { /* ignore */ });
    return () => { if (open) window.electronAPI.setTopInset(0).catch(() => { /* ignore */ }); };
  }, [open]);

  useEffect(() => {
    window.electronAPI.getShelf().then(setShelf).catch(() => { /* ignore */ });
    const unsub = window.electronAPI.onShelfChanged(setShelf);
    return unsub;
  }, []);

  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? null;

  return (
    <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as never }}>
      <button
        title="Shelved tabs"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 30,
          height: 30,
          border: 'none',
          background: open ? 'rgba(74,158,255,0.2)' : 'transparent',
          color: open ? '#4a9eff' : shelf.length > 0 ? '#e8a020' : '#aaa',
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
        📚
        {shelf.length > 0 && (
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
            {shelf.length > 9 ? '9+' : shelf.length}
          </span>
        )}
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
              width: 320,
              maxHeight: 420,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                fontSize: 13,
                fontWeight: 600,
                color: '#e8e8f0',
              }}
            >
              Shelved Tabs ({shelf.length})
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {shelf.length === 0 ? (
                <div
                  style={{ padding: 16, color: '#666', fontSize: 13, textAlign: 'center' }}
                >
                  No shelved tabs
                </div>
              ) : (
                shelf.map((item) => (
                  <ShelfItemRow
                    key={item.id}
                    item={item}
                    groupName={groupName(item.groupId)}
                    onRestore={() => {
                      window.electronAPI.restoreFromShelf(item.id);
                      setOpen(false);
                    }}
                    onDelete={() => window.electronAPI.deleteFromShelf(item.id)}
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

function ShelfItemRow({
  item,
  groupName,
  onRestore,
  onDelete,
}: {
  item: ShelfItem;
  groupName: string | null;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const timeAgo = formatTimeAgo(item.shelvedAt);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {item.faviconUrl ? (
        <img
          src={item.faviconUrl}
          alt=""
          width={14}
          height={14}
          style={{ borderRadius: 2, flexShrink: 0 }}
        />
      ) : (
        <span style={{ fontSize: 12, flexShrink: 0, color: '#666' }}>○</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: '#e8e8f0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title || item.url}
        </div>
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
          {timeAgo}
          {groupName && (
            <span style={{ marginLeft: 6, color: '#4a9eff' }}>• {groupName}</span>
          )}
        </div>
      </div>
      <button
        onClick={onRestore}
        title="Restore tab"
        style={{
          background: 'rgba(74,158,255,0.15)',
          border: 'none',
          color: '#4a9eff',
          padding: '3px 8px',
          borderRadius: 4,
          fontSize: 11,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Restore
      </button>
      <button
        onClick={onDelete}
        title="Remove from shelf"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#666',
          cursor: 'pointer',
          fontSize: 12,
          padding: '3px 5px',
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
