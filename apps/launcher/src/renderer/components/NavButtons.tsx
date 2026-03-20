/**
 * NavButtons — back / forward / reload / stop
 * Disabled when the Links App tab is active.
 */
import React from 'react';
import refreshIcon from '../assets/icons/refresh.png';
import type { NavState } from '../../shared/types.js';

interface Props {
  activeTabId: string | null;
  nav: NavState | null;
  isLinksApp: boolean;
}

const navBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  border: 'none',
  background: 'transparent',
  color: '#aaa',
  fontSize: 15,
  cursor: 'pointer',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  WebkitAppRegion: 'no-drag' as never,
  transition: 'background 0.15s, color 0.15s',
};

const navBtnDisabled: React.CSSProperties = {
  ...navBtn,
  color: '#444',
  cursor: 'default',
};

export function NavButtons({ activeTabId, nav, isLinksApp }: Props) {
  if (!activeTabId || isLinksApp) {
    return (
      <div style={{ display: 'flex', gap: 2 }}>
        <button style={navBtnDisabled} disabled title="Back">◀</button>
        <button style={navBtnDisabled} disabled title="Forward">▶</button>
        <button style={{ ...navBtnDisabled, opacity: 0.25 }} disabled title="Reload">
          <img src={refreshIcon} alt="Reload" width={18} height={18} style={{ objectFit: 'contain' }} />
        </button>
      </div>
    );
  }

  const canBack   = nav?.canGoBack    ?? false;
  const canFwd    = nav?.canGoForward ?? false;
  const isLoading = nav?.isLoading    ?? false;

  const onHover = (disabled: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
  };
  const onLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLElement).style.background = 'transparent';
  };

  return (
    <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' as never }}>
      <button
        style={canBack ? navBtn : navBtnDisabled}
        disabled={!canBack}
        title="Back (Alt+Left)"
        onClick={() => window.electronAPI.goBack(activeTabId)}
        onMouseEnter={onHover(!canBack)}
        onMouseLeave={onLeave}
      >
        ◀
      </button>
      <button
        style={canFwd ? navBtn : navBtnDisabled}
        disabled={!canFwd}
        title="Forward (Alt+Right)"
        onClick={() => window.electronAPI.goForward(activeTabId)}
        onMouseEnter={onHover(!canFwd)}
        onMouseLeave={onLeave}
      >
        ▶
      </button>
      <button
        style={{ ...navBtn, opacity: isLoading ? 1 : 0.8 }}
        title={isLoading ? 'Stop' : 'Reload (Ctrl+R)'}
        onClick={() =>
          isLoading
            ? window.electronAPI.stopLoading(activeTabId)
            : window.electronAPI.reload(activeTabId)
        }
        onMouseEnter={onHover(false)}
        onMouseLeave={onLeave}
      >
        {isLoading
          ? <span style={{ fontSize: 13, color: '#e74c3c' }}>✕</span>
          : <img src={refreshIcon} alt="Reload" width={18} height={18} style={{ objectFit: 'contain' }} />
        }
      </button>
    </div>
  );
}
