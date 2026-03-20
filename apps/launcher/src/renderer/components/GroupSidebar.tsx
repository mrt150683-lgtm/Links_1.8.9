/**
 * GroupSidebar — Phase C
 * Left sidebar showing project groups and their tabs.
 */
import React, { useState, useEffect } from 'react';
import type { TabState, TabGroup, ShelfItem } from '../../shared/types.js';

const PRESET_COLORS = [
  '#4a9eff', // blue
  '#e84040', // red
  '#e8a020', // amber
  '#40c97f', // green
  '#b060e8', // purple
  '#e84080', // pink
  '#40c8e8', // cyan
  '#808090', // gray
];

interface Props {
  tabs: TabState[];
  isOpen: boolean;
  onClose: () => void;
  activeTabId?: string | null;
}

export function GroupSidebar({ tabs, isOpen, onClose, activeTabId }: Props) {
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#4a9eff');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.electronAPI.getGroups().then(setGroups).catch(() => { /* ignore */ });
    window.electronAPI.getShelf().then(setShelf).catch(() => { /* ignore */ });
    const unsubG = window.electronAPI.onGroupsChanged(setGroups);
    const unsubS = window.electronAPI.onShelfChanged(setShelf);
    return () => { unsubG(); unsubS(); };
  }, []);

  if (!isOpen) return null;

  const tabsInGroup = (groupId: string) => tabs.filter((t) => t.groupId === groupId);
  const shelfInGroup = (groupId: string) => shelf.filter((s) => s.groupId === groupId);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await window.electronAPI.createGroup(newGroupName.trim(), newGroupColor);
    setNewGroupName('');
    setNewGroupColor('#4a9eff');
    setCreating(false);
  };

  return (
    <div
      style={{
        width: 240,
        height: '100%',
        background: '#18182a',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        WebkitAppRegion: 'no-drag' as never,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#e8e8f0' }}>
          Groups
        </span>
        <button
          onClick={() => setCreating(true)}
          title="New group"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#4a9eff',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          +
        </button>
        <button
          onClick={onClose}
          title="Close sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* New group form */}
      {creating && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            autoFocus
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateGroup();
              if (e.key === 'Escape') { setCreating(false); setNewGroupColor('#4a9eff'); }
            }}
            placeholder="Group name…"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(74,158,255,0.4)',
              borderRadius: 4,
              color: '#e8e8f0',
              fontSize: 12,
              padding: '5px 8px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {/* Color swatches */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => setNewGroupColor(c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: c,
                  border: newGroupColor === c ? '2px solid #fff' : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  outline: 'none',
                }}
              />
            ))}
          </div>
          <button
            onClick={handleCreateGroup}
            style={{
              marginTop: 8,
              width: '100%',
              background: newGroupColor,
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 0',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          >
            Create
          </button>
        </div>
      )}

      {/* Groups list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.length === 0 && (
          <div style={{ padding: 16, color: '#555', fontSize: 12, textAlign: 'center' }}>
            No groups yet.
            <br />
            Press + to create one.
          </div>
        )}
        {groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            activeTabs={tabsInGroup(g.id)}
            shelvedTabs={shelfInGroup(g.id)}
            activeTabId={activeTabId ?? null}
          />
        ))}

        {/* Ungrouped active tabs */}
        {tabs.filter((t) => !t.groupId && t.type === 'web').length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8, paddingTop: 8 }}>
            <div style={{ padding: '4px 12px', fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>
              Ungrouped
            </div>
            {tabs
              .filter((t) => !t.groupId && t.type === 'web')
              .map((t) => (
                <TabRow key={t.id} tab={t} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  group,
  activeTabs,
  shelvedTabs,
  activeTabId,
}: {
  group: TabGroup;
  activeTabs: TabState[];
  shelvedTabs: ShelfItem[];
  activeTabId?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: group.color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: '#c8c8e0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group.name}
        </span>
        <span style={{ fontSize: 10, color: '#555' }}>
          {activeTabs.length + shelvedTabs.length}
        </span>
        {/* Add current tab to this group */}
        {activeTabId && activeTabId !== 'links-app' && !activeTabs.some((t) => t.id === activeTabId) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI.assignTabToGroup(activeTabId, group.id);
            }}
            title={`Add current tab to "${group.name}"`}
            style={{
              background: 'transparent',
              border: '1px solid rgba(74,158,255,0.35)',
              borderRadius: 3,
              color: '#4a9eff',
              cursor: 'pointer',
              fontSize: 9,
              padding: '1px 5px',
              lineHeight: 1.5,
              flexShrink: 0,
            }}
          >
            + Add
          </button>
        )}
        <span style={{ fontSize: 10, color: '#555' }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ paddingBottom: 4 }}>
          {activeTabs.map((t) => (
            <TabRow
              key={t.id}
              tab={t}
              onRemove={() => window.electronAPI.removeTabFromGroup(t.id)}
            />
          ))}
          {shelvedTabs.map((s) => (
            <ShelfRow key={s.id} item={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabRow({ tab, onRemove }: { tab: TabState; onRemove?: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => window.electronAPI.switchTab(tab.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 20px',
        cursor: 'pointer',
        background: tab.isActive
          ? 'rgba(255,255,255,0.07)'
          : hovered
          ? 'rgba(255,255,255,0.04)'
          : 'transparent',
        borderRadius: 4,
        margin: '1px 4px',
      }}
    >
      {tab.faviconUrl ? (
        <img src={tab.faviconUrl} width={12} height={12} alt="" style={{ borderRadius: 2 }} />
      ) : (
        <span style={{ fontSize: 10, color: '#555' }}>○</span>
      )}
      <span
        style={{
          flex: 1,
          fontSize: 11,
          color: '#b8b8d0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tab.title || tab.url}
      </span>
      {onRemove && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from group"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 12,
            padding: '0 2px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ShelfRow({ item }: { item: ShelfItem }) {
  return (
    <div
      onClick={() => window.electronAPI.restoreFromShelf(item.id)}
      title="Restore from shelf"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 20px',
        cursor: 'pointer',
        borderRadius: 4,
        margin: '1px 4px',
        opacity: 0.6,
      }}
    >
      <span style={{ fontSize: 10, color: '#e8a020' }}>📚</span>
      <span
        style={{
          fontSize: 11,
          color: '#888',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontStyle: 'italic',
        }}
      >
        {item.title || item.url}
      </span>
    </div>
  );
}
