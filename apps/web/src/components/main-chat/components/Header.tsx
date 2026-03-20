import React from 'react';
import type { ModelInfo, PotChatSettings } from '../../pot-chat/potChatTypes';

interface MainChatHeaderProps {
  selectedModel: ModelInfo;
  usedTokensEstimate: number;
  isRightPanelOpen: boolean;
  isFullscreen: boolean;
  settings: PotChatSettings;
  unreadCount: number;
  activePanel: 'conversations' | 'inbox';
  onToggleRightPanel(): void;
  onToggleFullscreen(): void;
  onOpenSettings(): void;
  onNavigateHome?: () => void;
  onOpenInbox(): void;
}

export const Header: React.FC<MainChatHeaderProps> = ({
  selectedModel,
  usedTokensEstimate,
  isRightPanelOpen,
  isFullscreen,
  unreadCount,
  activePanel,
  onToggleRightPanel,
  onToggleFullscreen,
  onOpenSettings,
  onNavigateHome,
  onOpenInbox,
}) => {
  const pct = Math.min(100, (usedTokensEstimate / selectedModel.contextWindowTokens) * 100);

  return (
    <header className="main-chat__header">
      <div className="main-chat__header-left">
        <div className="main-chat__logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Links Chat</span>
        </div>
      </div>

      <div className="main-chat__header-right">
        <div className="main-chat__model-info">
          <div className="main-chat__model-name">
            <span>{selectedModel.displayName}</span>{' '}
            <span className="main-chat__model-ctx">({Math.round(selectedModel.contextWindowTokens / 1000)}k)</span>
          </div>
          <div className="main-chat__ctx-bar">
            <div className="main-chat__ctx-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Bell / Inbox button */}
        <button
          onClick={onOpenInbox}
          className={`main-chat__icon-btn main-chat__bell-btn${activePanel === 'inbox' && isRightPanelOpen ? ' main-chat__icon-btn--active' : ''}`}
          title={unreadCount > 0 ? `Inbox (${unreadCount} unread)` : 'Inbox'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="main-chat__bell-badge">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {onNavigateHome && (
          <button onClick={onNavigateHome} className="main-chat__icon-btn" title="Back to Dashboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
        )}
        <button onClick={onToggleFullscreen} className="main-chat__icon-btn" title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="10" y1="14" x2="3" y2="21" />
              <line x1="21" y1="3" x2="14" y2="10" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
        <button onClick={onOpenSettings} className="main-chat__icon-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button onClick={onToggleRightPanel} className="main-chat__icon-btn" title="Toggle panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: isRightPanelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </header>
  );
};
