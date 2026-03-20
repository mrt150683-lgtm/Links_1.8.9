import React, { forwardRef } from 'react';
import type { ChatMessage, PotEntry } from '../potChatTypes';
import { MessageBubble } from './MessageBubble';

interface TimelineProps {
  messages: ChatMessage[];
  entries: PotEntry[];
  showSourceSnippets: boolean;
  compactMode: boolean;
  replayEnabled: boolean;
  replaySpeed: number;
  isSending: boolean;
  onOpenEntry(entry: PotEntry): void;
  onAddToContext(entry: PotEntry): void;
  onReplayComplete(msgId: string): void;
}

export const Timeline = forwardRef<HTMLDivElement, TimelineProps>(
  ({
    messages,
    entries,
    showSourceSnippets,
    compactMode,
    replayEnabled,
    replaySpeed,
    isSending,
    onOpenEntry,
    onAddToContext,
    onReplayComplete,
  }, ref) => {
    return (
      <div
        ref={ref}
        className={`pot-chat__timeline ${compactMode ? 'pot-chat__timeline--compact' : ''}`}
      >
        {messages.map((msg, i) => (
          <React.Fragment key={msg.id}>
            {i > 0 && <div className="pot-chat__timeline-spacer" />}
            <MessageBubble
              msg={msg}
              entries={entries}
              showSourceSnippets={showSourceSnippets}
              compactMode={compactMode}
              replayEnabled={replayEnabled}
              replaySpeed={replaySpeed}
              onOpenEntry={onOpenEntry}
              onAddToContext={onAddToContext}
              onReplayComplete={onReplayComplete}
            />
          </React.Fragment>
        ))}
        {isSending && (
          <div className="pot-chat__sending">
            <div className="pot-chat__sending-dot" />
            <div className="pot-chat__sending-dot" />
            <div className="pot-chat__sending-dot" />
            <span>Thinking...</span>
          </div>
        )}
      </div>
    );
  },
);

Timeline.displayName = 'Timeline';
