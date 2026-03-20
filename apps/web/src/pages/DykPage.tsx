/**
 * DykPage — full-page DYK insights inbox
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DykInbox } from '@/components/dyk/DykInbox';
import './DykPage.css';

interface PotOption {
  id: string;
  name: string;
}

export function DykPage() {
  const [selectedPotId, setSelectedPotId] = useState<string>('');
  const navigate = useNavigate();

  const { data: potsData } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: PotOption[] }>('/pots'),
  });

  const pots = potsData?.pots ?? [];
  // Derive effective pot: user selection if set, otherwise first pot
  const effectivePotId = selectedPotId || (pots[0]?.id ?? '');

  function handleNavigateToChat(potId: string, seedMessage: string) {
    sessionStorage.setItem('dyk_chat_seed', seedMessage);
    navigate(`/pots/${potId}?tab=chat`);
  }

  return (
    <div className="dyk-page">
      <div className="dyk-page__header">
        <h1 className="dyk-page__title">Insights</h1>
        <p className="dyk-page__subtitle">
          Did You Know? Auto-generated micro-insights from your research entries.
        </p>
      </div>

      {pots.length > 1 && (
        <div className="dyk-page__pot-select">
          <label className="dyk-page__label" htmlFor="pot-select">Pot</label>
          <select
            id="pot-select"
            className="dyk-page__select"
            value={effectivePotId}
            onChange={(e) => setSelectedPotId(e.target.value)}
          >
            {pots.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {effectivePotId ? (
        <DykInbox
          potId={effectivePotId}
          onNavigateToChat={handleNavigateToChat}
        />
      ) : (
        <div className="dyk-page__empty">No pots available.</div>
      )}
    </div>
  );
}
