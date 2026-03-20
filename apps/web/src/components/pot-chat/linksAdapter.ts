import { api } from '../../lib/api';
import type { PotChatAdapter } from './adapter';
import type { PotEntry, ChatThread, ChatMessage } from './potChatTypes';

function mapEntryToPotEntry(e: any): PotEntry {
  return {
    id: e.id,
    potId: e.pot_id,
    title: e.source_title || e.link_title || `${e.type} entry`,
    type: e.type,
    url: e.source_url || e.link_url,
    capturedAt: new Date(e.captured_at).toISOString(),
    artifacts: {
      tags: e.tags ?? [],
      entities: e.entities ?? [],
      summaryBullets: e.summary_bullets ?? [],
      shortSummary: e.short_summary ?? '',
    },
    content: e.content_text,
    sizeBytes: e.content_text?.length ?? 0,
  };
}

function mapMessageResponse(m: any): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations,
    timestamp: m.timestamp,
  };
}

function mapThreadResponse(t: any): ChatThread {
  return {
    id: t.id,
    potId: t.pot_id,
    createdAt: t.created_at,
    lastUpdatedAt: t.updated_at,
    messages: (t.messages ?? []).map(mapMessageResponse),
    summary: t.title,
  };
}

export function createLinksAdapter(): PotChatAdapter {
  return {
    async listEntries(potId) {
      const data = await api.get<{ entries: any[] }>(`/pots/${potId}/entries`);
      return data.entries.map(mapEntryToPotEntry);
    },

    async listThreads(potId) {
      const data = await api.get<{ threads: any[] }>(`/pots/${potId}/chat/threads`);
      return data.threads.map(mapThreadResponse);
    },

    async sendMessage(potId, content, threadId, activeContextEntryIds, modelId, knowledgeMode, executionMode) {
      // Don't send temporary thread IDs to the server — let it create a new thread
      const isTemp = threadId.startsWith('thread-');
      const data = await api.post<{ assistant_message: any; thread_id: string; mom_run_id?: string }>(
        `/pots/${potId}/chat/send`,
        {
          thread_id: isTemp ? undefined : threadId,
          content,
          active_context_entry_ids: activeContextEntryIds,
          model_id: modelId || undefined,
          knowledge_mode: knowledgeMode ?? 'strict',
          execution_mode: executionMode ?? 'single',
        },
      );
      const msg = mapMessageResponse(data.assistant_message) as ReturnType<typeof mapMessageResponse> & { _momRunId?: string };
      // Stash the server-assigned thread_id so PotChat can pick it up
      (msg as any)._threadId = data.thread_id;
      // Stash MoM run ID if present
      if (data.mom_run_id) msg._momRunId = data.mom_run_id;
      return msg;
    },

    async saveThreadAsEntry(potId, thread) {
      const data = await api.post<any>(
        `/pots/${potId}/chat/threads/${thread.id}/save-as-entry`,
      );
      return mapEntryToPotEntry(data);
    },

    async getThreadMessages(potId, threadId) {
      const data = await api.get<{ id: string; pot_id: string; messages: any[] }>(
        `/pots/${potId}/chat/threads/${threadId}`,
      );
      return (data.messages ?? []).map(mapMessageResponse);
    },

    async loadEntryContent(entryId) {
      const entry = await api.get<any>(`/entries/${entryId}`);
      return {
        content: entry.content_text,
        thumbnailUrl: entry.asset?.thumbnail_url,
        fullImageUrl: entry.asset?.url,
      };
    },
  };
}
