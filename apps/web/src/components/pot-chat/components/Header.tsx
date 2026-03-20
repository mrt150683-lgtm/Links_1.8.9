import React from 'react';
import type { ModelInfo } from '../potChatTypes';
import type { PotChatSettings } from '../potChatTypes';

interface HeaderProps {
  selectedModel: ModelInfo;
  usedTokensEstimate: number;
  isRightPanelOpen: boolean;
  isFullscreen: boolean;
  isCalendarOpen: boolean;
  settings: PotChatSettings;
  onToggleRightPanel(): void;
  onToggleFullscreen(): void;
  onOpenSettings(): void;
  onNavigateHome?: () => void;
  onToggleKnowledgeMode(): void;
  onToggleCalendar(): void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedModel,
  usedTokensEstimate,
  isRightPanelOpen,
  isFullscreen,
  isCalendarOpen,
  settings,
  onToggleRightPanel,
  onToggleFullscreen,
  onOpenSettings,
  onNavigateHome,
  onToggleKnowledgeMode,
  onToggleCalendar,
}) => {
  const isOpen = settings.knowledgeMode === 'open';
  const pct = Math.min(100, (usedTokensEstimate / selectedModel.contextWindowTokens) * 100);

  return (
    <header className="pot-chat__header">
      <div className="pot-chat__header-left">
        <div className="pot-chat__logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Pot Chat</span>
        </div>
        <div className="pot-chat__divider" />
        <div className="pot-chat__ctx-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            {settings.metadataOnlyByDefault ? 'Default Context: Metadata Only' : 'Default Context: Full Content'}
          </span>
        </div>
      </div>

      <div className="pot-chat__header-right">
        <div className="pot-chat__model-info">
          <div className="pot-chat__model-name">
            <span>{selectedModel.displayName}</span>{' '}
            <span className="pot-chat__model-ctx">({Math.round(selectedModel.contextWindowTokens / 1000)}k)</span>
          </div>
          <div className="pot-chat__ctx-bar">
            <div className="pot-chat__ctx-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {onNavigateHome && (
          <button onClick={onNavigateHome} className="pot-chat__icon-btn" title="Back to pot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
        )}

        {/* Knowledge mode toggle */}
        <button
          onClick={onToggleKnowledgeMode}
          className={`pot-chat__icon-btn pot-chat__knowledge-btn${isOpen ? ' pot-chat__knowledge-btn--open' : ''}`}
          title={isOpen ? 'Open Knowledge: model can use training knowledge (click to lock to pot only)' : 'Strict Mode: answers limited to pot contents (click to unlock training knowledge)'}
        >
          {isOpen ? (
            /* Unlocked padlock */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          ) : (
            /* Locked padlock */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
        </button>

        <button onClick={onToggleFullscreen} className="pot-chat__icon-btn" title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
          {isFullscreen ? (
            /* Minimize icon */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="10" y1="14" x2="3" y2="21" />
              <line x1="21" y1="3" x2="14" y2="10" />
            </svg>
          ) : (
            /* Maximize icon */
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
        <button
          onClick={onToggleCalendar}
          className={`pot-chat__icon-btn${isCalendarOpen ? ' pot-chat__icon-btn--active' : ''}`}
          title={isCalendarOpen ? 'Close calendar' : 'Open calendar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <button onClick={onOpenSettings} className="pot-chat__icon-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button onClick={onToggleRightPanel} className="pot-chat__icon-btn" title="Toggle panel">
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
