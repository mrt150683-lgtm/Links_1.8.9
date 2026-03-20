import React from 'react';
import type { PotEntry } from '../potChatTypes';
import { EntryIcon } from './EntryIcon';

interface EntryViewerModalProps {
  entry: PotEntry;
  onClose(): void;
  onAddToContext(entry: PotEntry): void;
  onViewImage(url: string): void;
}

export const EntryViewerModal: React.FC<EntryViewerModalProps> = ({
  entry,
  onClose,
  onAddToContext,
  onViewImage,
}) => {
  return (
    <div className="pot-chat__modal-backdrop" onClick={onClose}>
      <div className="pot-chat__modal pot-chat__modal--md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pot-chat__modal-header">
          <div className="pot-chat__modal-header-left">
            <EntryIcon type={entry.type} className="pot-chat__entry-icon--gold" />
            <h2 className="pot-chat__modal-title">{entry.title}</h2>
          </div>
          <button onClick={onClose} className="pot-chat__modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="pot-chat__modal-body">
          <div className="pot-chat__ev-grid">
            <div>
              <div className="pot-chat__ev-section-label">Summary</div>
              <p className="pot-chat__ev-summary">{entry.artifacts.shortSummary}</p>
              <ul className="pot-chat__ev-bullets">
                {entry.artifacts.summaryBullets.map((b, i) => (
                  <li key={i} className="pot-chat__ev-bullet">
                    <span className="pot-chat__ev-bullet-dot">&bull;</span> {b}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="pot-chat__ev-section-label">Tags &amp; Entities</div>
              <div className="pot-chat__ev-tags">
                {entry.artifacts.tags.map((t, i) => (
                  <span key={`t-${i}`} className="pot-chat__ev-tag">{t.label}</span>
                ))}
                {entry.artifacts.entities.map((en, i) => (
                  <span key={`e-${i}`} className="pot-chat__ev-entity">{en.label}</span>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="pot-chat__ev-section-label">Content Preview</div>
            {entry.type === 'image' && entry.thumbnailUrl ? (
              <div
                className="pot-chat__ev-image"
                onClick={() => onViewImage(entry.fullImageUrl || entry.thumbnailUrl!)}
              >
                <img src={entry.thumbnailUrl} alt={entry.title} />
                <div className="pot-chat__ev-image-overlay">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="pot-chat__ev-content">
                {entry.content || 'Content not loaded. Add to active context to analyze full text.'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pot-chat__modal-footer">
          <button onClick={onClose} className="pot-chat__btn-text">Close</button>
          <button
            onClick={() => { onAddToContext(entry); onClose(); }}
            className="pot-chat__btn-gold"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add to Active Context
          </button>
        </div>
      </div>
    </div>
  );
};
