import { api } from '../../lib/api';
import type { MainChatAdapter, MainChatThread, MainChatNotification, MainChatContextPack } from './mainChatAdapter';
import type { ChatMessage } from '../pot-chat/potChatTypes';

function mapThread(t: any): MainChatThread {
  return {
    id: t.id,
    title: t.title ?? null,
    model_id: t.model_id ?? null,
    createdAt: t.created_at,
    lastUpdatedAt: t.updated_at,
    message_count: t.message_count ?? 0,
  };
}

function mapMessage(m: any): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations,
    timestamp: m.timestamp,
  };
}

function mapNotification(n: any): MainChatNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    preview: n.preview ?? null,
    payload: n.payload ?? null,
    state: n.state,
    snoozedUntil: n.snoozed_until ?? null,
    readAt: n.read_at ?? null,
    createdAt: n.created_at,
  };
}

export function createLinksMainChatAdapter(): MainChatAdapter {
  return {
    async listThreads() {
      const d = await api.get<{ threads: any[] }>('/main-chat/threads');
      return d.threads.map(mapThread);
    },

    async getThreadMessages(threadId) {
      const d = await api.get<{ messages: any[] }>(`/main-chat/threads/${threadId}/messages`);
      return d.messages.map(mapMessage);
    },

    async sendMessage(params) {
      const d = await api.post<{ thread_id: string; thread_title?: string; assistant_message: any; mom_run_id?: string }>('/main-chat/send', params);
      return {
        assistantMessage: mapMessage(d.assistant_message),
        thread_id: d.thread_id,
        ...(d.thread_title ? { thread_title: d.thread_title } : {}),
        ...(d.mom_run_id ? { mom_run_id: d.mom_run_id } : {}),
      };
    },

    async deleteThread(threadId) {
      await api.delete(`/main-chat/threads/${threadId}`);
    },

    async getContextPack() {
      const d = await api.get<MainChatContextPack>('/main-chat/context-pack');
      return d;
    },

    async listNotifications() {
      const d = await api.get<{ notifications: any[] }>('/main-chat/notifications');
      return d.notifications.map(mapNotification);
    },

    async getUnreadCount() {
      const d = await api.get<{ count: number }>('/main-chat/notifications/unread-count');
      return d.count;
    },

    async openNotification(id) {
      await api.post(`/main-chat/notifications/${id}/open`, {});
    },

    async dismissNotification(id) {
      await api.post(`/main-chat/notifications/${id}/dismiss`, {});
    },

    async snoozeNotification(id, hours = 24) {
      await api.post(`/main-chat/notifications/${id}/snooze`, { hours });
    },
  };
}
