import type { PotEntry, ChatThread, ChatMessage } from './potChatTypes';

export type ExecutionMode = 'single' | 'mom_lite' | 'mom_standard' | 'mom_heavy';

export interface PotChatAdapter {
  listEntries(potId: string): Promise<PotEntry[]>;
  listThreads(potId: string): Promise<ChatThread[]>;
  sendMessage(
    potId: string,
    content: string,
    threadId: string,
    activeContextEntryIds: string[],
    modelId?: string,
    knowledgeMode?: 'strict' | 'open',
    executionMode?: ExecutionMode,
  ): Promise<ChatMessage & { _momRunId?: string }>;
  saveThreadAsEntry(potId: string, thread: ChatThread): Promise<PotEntry>;
  openEntry?(entryId: string): Promise<void> | void;
  loadEntryContent?(entryId: string): Promise<{
    content?: string;
    fullImageUrl?: string;
    thumbnailUrl?: string;
  }>;
  getThreadMessages?(potId: string, threadId: string): Promise<ChatMessage[]>;
  estimateTokens?(input: string): number;
  nowIso?(): string;
}
