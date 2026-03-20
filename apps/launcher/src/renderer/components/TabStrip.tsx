/**
 * TabStrip — pinned Links tab + web tabs row.
 */
import React, { useRef } from 'react';
import type { TabState, TabGroup } from '../../shared/types.js';

interface Props {
  tabs: TabState[];
  groups: TabGroup[];
  onNewTab: () => void;
}

function groupColor(groups: TabGroup[], groupId?: string): string {
  if (!groupId) return 'transparent';
  return groups.find((g) => g.id === groupId)?.color ?? 'transparent';
}

export function TabStrip({ tabs, groups, onNewTab }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    if (stripRef.current) {
      stripRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        gap: 2,
        WebkitAppRegion: 'no-drag' as never,
      }}
    >
      <div
        ref={stripRef}
        onWheel={handleWheel}
        style={{
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          gap: 2,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {tabs.map((tab) => (
          <TabChip key={tab.id} tab={tab} groups={groups} groupColor={groupColor(groups, tab.groupId)} />
        ))}

        {/* New tab button — inside scroll area so it always follows the last tab */}
        <button
          title="New tab (Ctrl+T)"
          onClick={onNewTab}
          style={{
            width: 28,
            height: 28,
            border: 'none',
            background: 'transparent',
            color: '#aaa',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
            borderRadius: 4,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitAppRegion: 'no-drag' as never,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
        >
          +
        </button>
      </div>
    </div>
  );
}

function TabChip({
  tab,
  groups: _groups,
  groupColor,
}: {
  tab: TabState;
  groups: TabGroup[];
  groupColor: string;
}) {
  const isLinksApp = tab.type === 'links_app';
  const isActive = tab.isActive;

  return (
    <div
      title={tab.title || tab.url}
      onClick={() => window.electronAPI.switchTab(tab.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 8px',
        height: 28,
        maxWidth: 180,
        minWidth: 80,
        borderRadius: 5,
        cursor: 'pointer',
        background: isActive
          ? 'rgba(255,255,255,0.15)'
          : 'rgba(255,255,255,0.04)',
        border: isActive ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
        borderTop: groupColor !== 'transparent' ? `2px solid ${groupColor}` : undefined,
        flexShrink: 0,
        transition: 'background 0.15s',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
      }}
    >
      {/* Favicon / icon */}
      {isLinksApp ? (
        <span style={{ fontSize: 12, flexShrink: 0 }}>🔗</span>
      ) : tab.faviconUrl ? (
        <img
          src={tab.faviconUrl}
          alt=""
          width={12}
          height={12}
          style={{ borderRadius: 2, objectFit: 'contain', flexShrink: 0 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : tab.isLoading ? (
        <span style={{ fontSize: 10, flexShrink: 0, animation: 'spin 1s linear infinite' }}>⟳</span>
      ) : (
        <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>○</span>
      )}

      {/* Title */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: isActive ? '#e8e8f0' : '#aaa',
        }}
      >
        {tab.title || tab.url || (isLinksApp ? 'Links' : 'New Tab')}
      </span>

      {/* Close button — hidden for Links App */}
      {!isLinksApp && (
        <button
          title="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            window.electronAPI.closeTab(tab.id);
          }}
          style={{
            width: 16,
            height: 16,
            border: 'none',
            background: 'transparent',
            color: '#888',
            fontSize: 11,
            cursor: 'pointer',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)';
            (e.currentTarget as HTMLElement).style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#888';
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
