import React, { forwardRef } from 'react';
import type { ExecutionMode } from '../adapter';

const MODE_LABELS: Record<ExecutionMode, string> = {
  single: 'Single',
  mom_lite: 'MoM Lite',
  mom_standard: 'MoM Std',
  mom_heavy: 'MoM Heavy',
};

const MODE_TITLES: Record<ExecutionMode, string> = {
  single: 'Single model — click to switch to MoM Lite',
  mom_lite: 'MoM Lite: parallel agents, fast merge — click for MoM Standard',
  mom_standard: 'MoM Standard: 4 agents + cross-review — click for MoM Heavy',
  mom_heavy: 'MoM Heavy: 6 agents + review — click to reset to Single',
};

interface ComposerProps {
  value: string;
  isSaved: boolean;
  compactMode: boolean;
  disabled: boolean;
  executionMode: ExecutionMode;
  isVoiceActive?: boolean;
  onChange(text: string): void;
  onSend(): void;
  onSave(): void;
  onOpenBrowser(): void;
  onCycleMode(): void;
  onToggleVoice?(): void;
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  ({ value, isSaved, compactMode, disabled, executionMode, isVoiceActive, onChange, onSend, onSave, onOpenBrowser, onCycleMode, onToggleVoice }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    };

    return (
      <div className={`pot-chat__composer ${compactMode ? 'pot-chat__composer--compact' : ''}`}>
        <div className="pot-chat__composer-inner">
          <button
            onClick={onCycleMode}
            className={`pot-chat__composer-btn pot-chat__mode-btn${executionMode !== 'single' ? ' pot-chat__mode-btn--active' : ''}`}
            title={MODE_TITLES[executionMode]}
          >
            {MODE_LABELS[executionMode]}
          </button>
          <button onClick={onOpenBrowser} className="pot-chat__composer-btn" title="Add sources (Ctrl+K)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          {onToggleVoice && (
            <button
              onClick={onToggleVoice}
              className={`pot-chat__composer-btn pot-chat__voice-btn${isVoiceActive ? ' pot-chat__voice-btn--active' : ''}`}
              title={isVoiceActive ? 'Stop voice session' : 'Start voice session'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the pot... (Ctrl+L to focus)"
            className="pot-chat__textarea"
            rows={1}
            disabled={disabled}
          />

          <button
            onClick={onSend}
            disabled={!value.trim() || disabled}
            className="pot-chat__send-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <div className="pot-chat__composer-footer">
          <span>Shift+Enter for newline, Enter to send</span>
          {isSaved ? (
            <span className="pot-chat__saved-indicator">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Saved to pot
            </span>
          ) : (
            <button onClick={onSave} className="pot-chat__save-link">
              Save transcript now
            </button>
          )}
        </div>
      </div>
    );
  },
);

Composer.displayName = 'Composer';
