/**
 * AgentPage (top-level route)
 *
 * Pot selector + agent overview when navigated to /agent.
 * If a pot is selected, renders the per-pot AgentPage component.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Pot } from '@/lib/types';
import { AgentPage as AgentPotPage } from '@/features/agent/AgentPage';

export function AgentPage() {
  const { data } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });

  const pots = data?.pots ?? [];
  const [selectedPotId, setSelectedPotId] = useState<string>('');

  const effectivePotId = selectedPotId || pots[0]?.id || '';

  if (pots.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #e0d8c8)', marginBottom: 8 }}>
          Agent
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>
          Create a pot first to enable the autonomous agent.
        </div>
      </div>
    );
  }

  return (
    <div>
      {pots.length > 1 && (
        <div style={{ padding: '12px 24px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>Pot:</label>
          <select
            value={effectivePotId}
            onChange={(e) => setSelectedPotId(e.target.value)}
            style={{
              background: 'var(--bg-secondary, #242424)',
              border: '1px solid var(--border, #3a3a3a)',
              borderRadius: 4,
              color: 'var(--text-primary, #e0d8c8)',
              fontSize: 12,
              padding: '4px 8px',
            }}
          >
            {pots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <AgentPotPage potId={effectivePotId} />
    </div>
  );
}
