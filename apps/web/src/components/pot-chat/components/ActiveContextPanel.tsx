import React from 'react';
import type { ActiveContextItem } from '../potChatTypes';
import { EntryIcon } from './EntryIcon';

interface ActiveContextPanelProps {
  activeContext: ActiveContextItem[];
  onRemove(id: string): void;
  onClearAll(): void;
}

export const ActiveContextPanel: React.FC<ActiveContextPanelProps> = ({
  activeContext,
  onRemove,
  onClearAll,
}) => {
  return (
    <div>
      <div className="pot-chat__ctx-header">
        <span className="pot-chat__ctx-label">
          Loaded Entries ({activeContext.length})
        </span>
        {activeContext.length > 0 && (
          <button onClick={onClearAll} className="pot-chat__ctx-clear">
            Clear All
          </button>
        )}
      </div>

      {activeContext.length === 0 ? (
        <div className="pot-chat__ctx-empty">
          No entries in active context.<br />Using metadata only.
        </div>
      ) : (
        <div>
          {activeContext.map((item) => (
            <div key={item.entry.id} className="pot-chat__ctx-item">
              <EntryIcon type={item.entry.type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pot-chat__ctx-item-title">{item.entry.title}</div>
                <div className="pot-chat__ctx-item-size">{Math.round(item.entry.sizeBytes / 1024)} KB</div>
              </div>
              <button
                onClick={() => onRemove(item.entry.id)}
                className="pot-chat__ctx-item-remove"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
