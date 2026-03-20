/**
 * WindowControls — Phase L
 * Custom minimize / maximize / close buttons for frame-less window.
 */
import React from 'react';

const btn: React.CSSProperties = {
  width: 46,
  height: 32,
  border: 'none',
  background: 'transparent',
  color: '#aaa',
  fontSize: 12,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag' as never,
  transition: 'background 0.15s',
  flexShrink: 0,
};

export function WindowControls() {
  const handleMinimize = () => window.electronAPI.minimizeWindow();
  const handleMaximize = () => window.electronAPI.maximizeWindow();
  const handleClose = () => window.electronAPI.closeWindow();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        WebkitAppRegion: 'no-drag' as never,
      }}
    >
      <button
        title="Minimize"
        style={btn}
        onClick={handleMinimize}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        ─
      </button>
      <button
        title="Maximize"
        style={btn}
        onClick={handleMaximize}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        □
      </button>
      <button
        title="Close"
        style={{ ...btn, borderRadius: '0 4px 4px 0' }}
        onClick={handleClose}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#c42b1c')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        ✕
      </button>
    </div>
  );
}
