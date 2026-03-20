import type { ChatMessage } from '../pot-chat/potChatTypes';
import type { ExecutionMode } from '../pot-chat/adapter';

// Separate type — no potId, no embedded messages
export interface MainChatThread {
  id: string;
  title: string | null;
  model_id: string | null;
  createdAt: string;
  lastUpdatedAt: string;
  message_count: number;
}

export interface MainChatNotification {
  id: string;
  type: string;
  title: string;
  preview: string | null;
  payload: unknown | null;
  state: string;
  snoozedUntil: number | null;
  readAt: number | null;
  createdAt: number;
}

export interface MainChatContextPack {
  greeting: string;
  notification_count: number;
  notifications: Array<{ id: string; type: string; title: string; preview: string | null }>;
  latest_journal: { date: string; first_line: string } | null;
  latest_digest: { date: string; headline: string } | null;
  recent_entry_count: number;
}

export interface MainChatAdapter {
  // Threads
  listThreads(): Promise<MainChatThread[]>;
  getThreadMessages(threadId: string): Promise<ChatMessage[]>;
  sendMessage(params: { thread_id?: string; model_id: string; content: string; include_context?: boolean; execution_mode?: ExecutionMode }): Promise<{
    assistantMessage: ChatMessage;
    thread_id: string;
    thread_title?: string;
    mom_run_id?: string;
  }>;
  deleteThread(threadId: string): Promise<void>;

  // Context pack (Slice 3)
  getContextPack(): Promise<MainChatContextPack>;

  // Notifications
  listNotifications(): Promise<MainChatNotification[]>;
  getUnreadCount(): Promise<number>;
  openNotification(id: string): Promise<void>;
  dismissNotification(id: string): Promise<void>;
  snoozeNotification(id: string, hours?: number): Promise<void>;
}
