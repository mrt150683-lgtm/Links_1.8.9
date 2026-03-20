/**
 * DykCard — renders a single "Did You Know" micro-insight card
 * with feedback actions and launchpad buttons.
 */

import { useState } from 'react';
import './DykCard.css';

export interface DykItemView {
  id: string;
  pot_id: string;
  entry_id: string;
  title: string;
  body: string;
  keywords: string[];
  confidence: number;
  novelty: number;
  status: string;
}

interface DykCardProps {
  item: DykItemView;
  onFeedback?: (dykId: string, action: string, snoozeHours?: number) => Promise<void>;
  onChat?: (dykId: string, potId: string, seedMessage: string) => void;
  onSearch?: (dykId: string, keywords: string[]) => void;
}

const SNOOZE_OPTIONS = [
  { label: '2 hours', hours: 2 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
];

export function DykCard({ item, onFeedback, onChat, onSearch }: DykCardProps) {
  const [showSnooze, setShowSnooze] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleFeedback(action: string, snoozeHours?: number) {
    if (loading) return;
    setLoading(true);
    try {
      await onFeedback?.(item.id, action, snoozeHours);
      setFeedbackDone(true);
      setShowSnooze(false);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    onSearch?.(item.id, item.keywords);
    onFeedback?.(item.id, 'opened_search');
  }

  function handleChat() {
    const seed = `${item.title}\n\n${item.body}\n\nDig deeper about this.`;
    onChat?.(item.id, item.pot_id, seed);
    onFeedback?.(item.id, 'opened_chat');
  }

  if (feedbackDone) {
    return null; // Card disappears after feedback
  }

  const confidencePct = Math.round(item.confidence * 100);
  const noveltyPct = Math.round(item.novelty * 100);

  return (
    <div className="dyk-card">
      <div className="dyk-card__header">
        <span className="dyk-card__title">{item.title}</span>
        <div className="dyk-card__badges">
          <span className="dyk-card__badge dyk-card__badge--conf" title="Confidence">
            {confidencePct}%
          </span>
          <span className="dyk-card__badge dyk-card__badge--nov" title="Novelty">
            ✦ {noveltyPct}%
          </span>
        </div>
      </div>

      <p className="dyk-card__body">{item.body}</p>

      {item.keywords.length > 0 && (
        <div className="dyk-card__keywords">
          {item.keywords.slice(0, 6).map((kw) => (
            <span key={kw} className="dyk-card__keyword">{kw}</span>
          ))}
        </div>
      )}

      <div className="dyk-card__actions">
        <div className="dyk-card__feedback">
          <button
            className="dyk-card__btn dyk-card__btn--known"
            onClick={() => handleFeedback('known')}
            disabled={loading}
            title="I already know this"
          >
            Known
          </button>
          <button
            className="dyk-card__btn dyk-card__btn--interested"
            onClick={() => handleFeedback('interested')}
            disabled={loading}
            title="I want to explore this"
          >
            Interested
          </button>

          <div className="dyk-card__snooze-wrap">
            <button
              className="dyk-card__btn dyk-card__btn--snooze"
              onClick={() => setShowSnooze((s) => !s)}
              disabled={loading}
              title="Snooze this insight"
            >
              Snooze ▾
            </button>
            {showSnooze && (
              <div className="dyk-card__snooze-menu">
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    className="dyk-card__snooze-opt"
                    onClick={() => handleFeedback('snooze', opt.hours)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className="dyk-card__btn dyk-card__btn--useless"
            onClick={() => handleFeedback('useless')}
            disabled={loading}
            title="Not relevant"
          >
            ✕
          </button>
        </div>

        <div className="dyk-card__launchpad">
          <button
            className="dyk-card__btn dyk-card__btn--search"
            onClick={handleSearch}
            title="Search for related content"
          >
            🔍 Search
          </button>
          <button
            className="dyk-card__btn dyk-card__btn--chat"
            onClick={handleChat}
            title="Discuss in chat"
          >
            💬 Chat
          </button>
        </div>
      </div>
    </div>
  );
}
