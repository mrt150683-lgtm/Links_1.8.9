/**
 * SidebarToggle — Phase G
 * Button to open/close the AI chat sidebar.
 */
import React from 'react';

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

export function SidebarToggle({ isOpen, onToggle }: Props) {
  return (
    <button
      title={isOpen ? 'Close AI sidebar' : 'Open AI sidebar'}
      onClick={onToggle}
      style={{
        width: 30,
        height: 30,
        border: 'none',
        background: isOpen ? 'rgba(74,158,255,0.2)' : 'transparent',
        color: isOpen ? '#4a9eff' : '#aaa',
        fontSize: 14,
        cursor: 'pointer',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        WebkitAppRegion: 'no-drag' as never,
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={(e) => {
        if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      💬
    </button>
  );
}
