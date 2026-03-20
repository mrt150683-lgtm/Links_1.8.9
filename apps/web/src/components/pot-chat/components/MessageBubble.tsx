import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PotEntry } from '../potChatTypes';
import { EntryIcon } from './EntryIcon';
import { renderMarkdown } from '../markdown';

interface MessageBubbleProps {
  msg: ChatMessage;
  entries: PotEntry[];
  showSourceSnippets: boolean;
  compactMode: boolean;
  replayEnabled: boolean;
  replaySpeed: number;
  onOpenEntry(entry: PotEntry): void;
  onAddToContext(entry: PotEntry): void;
  onReplayComplete?(msgId: string): void;
}

// ── Citations panel ──────────────────────────────────────────────────────────

interface CitationsPanelProps {
  citations: ChatMessage['citations'];
  entries: PotEntry[];
  showSourceSnippets: boolean;
  onOpenEntry(entry: PotEntry): void;
  onAddToContext(entry: PotEntry): void;
}

function confColor(conf: number): string {
  if (conf >= 0.9) return 'var(--cit-high, #4caf50)';
  if (conf >= 0.7) return 'var(--gold-1, #f5c842)';
  return 'var(--cit-low, #e57373)';
}

const CitationsPanel: React.FC<CitationsPanelProps> = ({
  citations,
  entries,
  showSourceSnippets,
  onOpenEntry,
  onAddToContext,
}) => {
  const [open, setOpen] = useState(false);

  if (!citations || citations.length === 0) {
    return (
      <div className="pot-chat__no-citation">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>No sources cited</span>
      </div>
    );
  }

  return (
    <div className="pot-chat__sources">
      <button
        className="pot-chat__sources-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span>Sources ({citations.length})</span>
        <svg
          className={`pot-chat__sources-chevron ${open ? 'pot-chat__sources-chevron--open' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="pot-chat__sources-list">
          {citations.map((cit, idx) => {
            const entry = entries.find((e) => e.id === cit.entryId);
            if (!entry) return null;
            const pct = Math.round(cit.confidence * 100);
            return (
              <div
                key={idx}
                className="pot-chat__cit-card"
                onClick={() => onOpenEntry(entry)}
                title={`Open: ${entry.title}`}
              >
                {/* Top row: icon + title + confidence + add */}
                <div className="pot-chat__cit-card-top">
                  <span className="pot-chat__cit-icon">
                    {entry.type === 'image' && entry.thumbnailUrl ? (
                      <img src={entry.thumbnailUrl} alt="" style={{ width: 14, height: 14, borderRadius: 2, objectFit: 'cover' }} />
                    ) : (
                      <EntryIcon type={entry.type} />
                    )}
                  </span>
                  <span className="pot-chat__cit-title">{entry.title}</span>
                  <span className="pot-chat__cit-conf" style={{ color: confColor(cit.confidence) }}>
                    {pct}%
                  </span>
                  <button
                    className="pot-chat__citation-add"
                    onClick={(e) => { e.stopPropagation(); onAddToContext(entry); }}
                    title="Add to Active Context"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                {/* Snippet row */}
                {showSourceSnippets && cit.snippet && (
                  <div className="pot-chat__cit-snippet">
                    &ldquo;{cit.snippet}&rdquo;
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── MessageBubble ────────────────────────────────────────────────────────────

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  entries,
  showSourceSnippets,
  compactMode,
  replaySpeed,
  onOpenEntry,
  onAddToContext,
  onReplayComplete,
}) => {
  const isUser = msg.role === 'user';
  const isReplaying = msg.replayState === 'replaying';
  const isFinal = !msg.replayState || msg.replayState === 'final';

  // Replay state: tracks how many chars are visible during typewriter effect
  const [revealedChars, setRevealedChars] = useState(() =>
    isReplaying ? 0 : msg.content.length
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Clean up on unmount
  useEffect(() => stopInterval, []);

  // Drive replay when replayState transitions to 'replaying'
  useEffect(() => {
    if (msg.replayState !== 'replaying') {
      stopInterval();
      setRevealedChars(msg.content.length);
      return;
    }

    setRevealedChars(0);

    const content = msg.content;
    // One word per tick — fires every 1000/replaySpeed ms (250ms at 4 wps)
    const INTERVAL_MS = Math.max(16, Math.round(1000 / replaySpeed));

    // Mutable position tracked inside the closure (not React state)
    let pos = 0;

    intervalRef.current = setInterval(() => {
      // Skip any whitespace at current position (newlines, spaces)
      while (pos < content.length && /\s/.test(content[pos])) pos++;
      // Advance through the word
      while (pos < content.length && /\S/.test(content[pos])) pos++;
      // Include trailing spaces (but not newlines — next tick will pick them up)
      while (pos < content.length && content[pos] === ' ') pos++;

      const next = Math.min(pos, content.length);
      setRevealedChars(next);

      if (next >= content.length) {
        stopInterval();
        onReplayComplete?.(msg.id);
      }
    }, INTERVAL_MS);

    return stopInterval;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id, msg.replayState]);

  const handleSkip = () => {
    stopInterval();
    setRevealedChars(msg.content.length);
    onReplayComplete?.(msg.id);
  };

  if (isUser) {
    return (
      <div className={`pot-chat__msg pot-chat__msg--user ${compactMode ? 'pot-chat__msg--compact' : ''}`}>
        <div className="pot-chat__bubble pot-chat__bubble--user">
          <div className="pot-chat__bubble-text">{msg.content}</div>
        </div>
      </div>
    );
  }

  // Error state
  if (msg.isError) {
    return (
      <div className={`pot-chat__msg pot-chat__msg--assistant ${compactMode ? 'pot-chat__msg--compact' : ''}`}>
        <div className="pot-chat__bubble pot-chat__bubble--assistant pot-chat__bubble--error">
          <div className="pot-chat__bubble-text">{msg.content}</div>
        </div>
      </div>
    );
  }

  // Assistant — replaying (typewriter with live Markdown)
  if (isReplaying) {
    const visible = msg.content.slice(0, revealedChars);
    return (
      <div className={`pot-chat__msg pot-chat__msg--assistant ${compactMode ? 'pot-chat__msg--compact' : ''}`}>
        <div className="pot-chat__bubble pot-chat__bubble--assistant">
          <div
            className="pot-chat__md pot-chat__replay-live"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(visible) }}
          />
          <span className="pot-chat__replay-cursor" aria-hidden="true">▌</span>
          <button className="pot-chat__replay-skip" onClick={handleSkip} title="Jump to final">
            Skip ▶
          </button>
        </div>
      </div>
    );
  }

  // Assistant — final (Markdown rendered)
  return (
    <div className={`pot-chat__msg pot-chat__msg--assistant ${compactMode ? 'pot-chat__msg--compact' : ''}`}>
      <div className="pot-chat__bubble pot-chat__bubble--assistant">
        {isFinal && (
          <div
            className="pot-chat__md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}

        <CitationsPanel
          citations={msg.citations}
          entries={entries}
          showSourceSnippets={showSourceSnippets}
          onOpenEntry={onOpenEntry}
          onAddToContext={onAddToContext}
        />
      </div>
    </div>
  );
};
