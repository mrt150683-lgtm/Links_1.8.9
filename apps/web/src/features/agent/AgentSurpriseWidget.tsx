/**
 * AgentSurpriseWidget
 *
 * Shows today's delivered agent candidate for a pot.
 * Appears in pot detail or can be embedded in dashboard.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeliveredToday, useAgentFeedback, useOpenAgentChat } from './useAgent';
import type { AgentCandidate } from './useAgent';
import './agent.css';

interface Props {
  potId: string;
}

export function AgentSurpriseWidget({ potId }: Props) {
  const { data, isLoading } = useDeliveredToday(potId);
  const feedbackMut = useAgentFeedback();
  const openChatMut = useOpenAgentChat();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (isLoading) return null;
  const candidates = (data?.candidates ?? []).filter((c) => !dismissed.includes(c.id));
  if (candidates.length === 0) return null;

  return (
    <div className="agent-surprise-widget">
      {candidates.map((c) => (
        <AgentSurpriseCard
          key={c.id}
          candidate={c}
          onFeedback={async (action) => {
            await feedbackMut.mutateAsync({ candidateId: c.id, action, potId });
            if (['meh', 'useless', 'known'].includes(action)) {
              setDismissed((prev) => [...prev, c.id]);
            }
          }}
          onChat={async () => {
            const res = await openChatMut.mutateAsync(c.id);
            if (res?.chat_seed) {
              sessionStorage.setItem('chatSeed', res.chat_seed);
              navigate(`/pots/${potId}?tab=chat`);
            }
          }}
        />
      ))}
    </div>
  );
}

interface CardProps {
  candidate: AgentCandidate;
  onFeedback: (action: string) => Promise<void>;
  onChat: () => Promise<void>;
}

function AgentSurpriseCard({ candidate: c, onFeedback, onChat }: CardProps) {
  const [loading, setLoading] = useState(false);

  const act = async (action: string) => {
    setLoading(true);
    try {
      if (action === 'chat') {
        await onChat();
      } else {
        await onFeedback(action);
      }
    } finally {
      setLoading(false);
    }
  };

  const confPct = Math.round(c.confidence * 100);
  const novelPct = Math.round(c.novelty * 100);
  const typeLabel = c.candidate_type.replace(/_/g, ' ');
  const isToolOffer = c.candidate_type === 'tool_offer';

  return (
    <div className="agent-surprise-card">
      <div className="agent-surprise-card__header">
        <div className="agent-surprise-card__title">{c.title}</div>
        <div className="agent-surprise-card__badges">
          <span className="agent-surprise-card__badge agent-surprise-card__badge--type">
            {typeLabel}
          </span>
          <span className="agent-surprise-card__badge agent-surprise-card__badge--confidence">
            {confPct}%
          </span>
          <span className="agent-surprise-card__badge agent-surprise-card__badge--novelty">
            ✨ {novelPct}%
          </span>
        </div>
      </div>

      <div className="agent-surprise-card__body">{c.body}</div>

      {c.source_refs.length > 0 && (
        <div className="agent-surprise-card__sources">
          {c.source_refs.length} source{c.source_refs.length !== 1 ? 's' : ''}
        </div>
      )}

      <div className="agent-surprise-card__actions">
        <button
          className="agent-surprise-card__btn agent-surprise-card__btn--cool"
          onClick={() => act('cool')}
          disabled={loading}
        >
          Cool
        </button>
        <button
          className="agent-surprise-card__btn agent-surprise-card__btn--meh"
          onClick={() => act('meh')}
          disabled={loading}
        >
          Meh
        </button>
        <button
          className="agent-surprise-card__btn agent-surprise-card__btn--chat"
          onClick={() => act('chat')}
          disabled={loading}
        >
          Chat
        </button>
        {isToolOffer && c.launch_payload?.tool_id && (
          <>
            <button
              className="agent-surprise-card__btn agent-surprise-card__btn--approve"
              onClick={() => act('approved_tool')}
              disabled={loading}
            >
              Approve Tool
            </button>
            <button
              className="agent-surprise-card__btn agent-surprise-card__btn--reject"
              onClick={() => act('rejected_tool')}
              disabled={loading}
            >
              Reject
            </button>
          </>
        )}
        <button
          className="agent-surprise-card__btn"
          onClick={() => act('snooze')}
          disabled={loading}
        >
          Snooze
        </button>
      </div>
    </div>
  );
}
