/**
 * DykInbox — per-pot inbox list of DYK notifications
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DykCard } from './DykCard';
import type { DykItemView } from './DykCard';
import './DykInbox.css';

interface DykNotificationView {
  id: string;
  pot_id: string;
  dyk_id: string;
  title: string;
  body: string;
  status: string;
  created_at: number;
}

interface DykInboxProps {
  potId: string;
  onNavigateToChat?: (potId: string, seedMessage: string) => void;
}

function DykNotifCard({
  notif,
  onFeedback,
  onChat,
  onSearch,
}: {
  notif: DykNotificationView;
  onFeedback: (dykId: string, action: string, snoozeHours?: number) => Promise<void>;
  onChat: (dykId: string, potId: string, seed: string) => void;
  onSearch: (dykId: string, keywords: string[]) => void;
}) {
  const { data: item, isLoading } = useQuery({
    queryKey: ['dyk-item', notif.dyk_id],
    queryFn: () => api.get<DykItemView>(`/dyk/${notif.dyk_id}`),
  });

  if (isLoading) {
    return <div className="dyk-inbox__loading">Loading insight...</div>;
  }
  if (!item) return null;

  return (
    <DykCard
      item={item}
      onFeedback={onFeedback}
      onChat={onChat}
      onSearch={onSearch}
    />
  );
}

export function DykInbox({ potId, onNavigateToChat }: DykInboxProps) {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading, error } = useQuery({
    queryKey: ['dyk-inbox', potId],
    queryFn: () =>
      api.get<{ notifications: DykNotificationView[] }>(
        `/pots/${potId}/dyk/inbox?unread_only=true&limit=20`
      ).then((d) => d.notifications),
    refetchInterval: 60_000,
  });

  const feedbackMutation = useMutation({
    mutationFn: async ({ dykId, action, snoozeHours }: { dykId: string; action: string; snoozeHours?: number }) => {
      const notif = notifications.find((n) => n.dyk_id === dykId);
      if (notif) await api.post(`/dyk-notifications/${notif.id}/read`);
      await api.post(`/dyk/${dykId}/feedback`, { action, snooze_hours: snoozeHours });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dyk-inbox', potId] });
    },
  });

  async function handleFeedback(dykId: string, action: string, snoozeHours?: number) {
    await feedbackMutation.mutateAsync({ dykId, action, snoozeHours });
  }

  function handleSearch(dykId: string, keywords: string[]) {
    const q = keywords.slice(0, 3).join(' ');
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    api.post(`/dyk/${dykId}/feedback`, { action: 'opened_search' }).catch(() => {});
  }

  function handleChat(dykId: string, itemPotId: string, seed: string) {
    onNavigateToChat?.(itemPotId, seed);
    api.post(`/dyk/${dykId}/feedback`, { action: 'opened_chat' }).catch(() => {});
  }

  if (isLoading) {
    return <div className="dyk-inbox__loading">Loading insights...</div>;
  }

  if (error) {
    return <div className="dyk-inbox__error">Failed to load insights.</div>;
  }

  if (notifications.length === 0) {
    return (
      <div className="dyk-inbox__empty">
        <p>No new insights yet — more will appear as entries are processed.</p>
      </div>
    );
  }

  return (
    <div className="dyk-inbox">
      {notifications.map((notif) => (
        <DykNotifCard
          key={notif.id}
          notif={notif}
          onFeedback={handleFeedback}
          onChat={handleChat}
          onSearch={handleSearch}
        />
      ))}
    </div>
  );
}
