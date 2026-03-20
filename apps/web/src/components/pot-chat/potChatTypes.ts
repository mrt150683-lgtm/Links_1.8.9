export type EntryType = 'text' | 'doc' | 'image' | 'audio' | 'link' | 'chat';

export interface DerivedArtifacts {
  tags: Array<{ label: string; type: string; confidence: number }>;
  entities: Array<{ label: string; type: string; confidence: number }>;
  summaryBullets: string[];
  shortSummary: string;
}

export interface PotEntry {
  id: string;
  potId: string;
  title: string;
  type: EntryType;
  url?: string;
  capturedAt: string;
  artifacts: DerivedArtifacts;
  content?: string;
  thumbnailUrl?: string;
  fullImageUrl?: string;
  sizeBytes: number;
}

export interface Citation {
  entryId: string;
  confidence: number;
  snippet?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  timestamp: string;
  isStreaming?: boolean;
  isError?: boolean;
  /** Playback state — 'replaying' = typewriter active; 'final' (or undefined) = render Markdown */
  replayState?: 'replaying' | 'final';
}

export interface ChatThread {
  id: string;
  potId: string;
  createdAt: string;
  lastUpdatedAt: string;
  messages: ChatMessage[];
  summary?: string;
}

export interface ActiveContextItem {
  entry: PotEntry;
  addedAt: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindowTokens: number;
}

export interface CtxUsage {
  usedTokensEstimate: number;
  availableTokensEstimate: number;
}

export type KnowledgeMode = 'strict' | 'open';

export interface PotChatSettings {
  metadataOnlyByDefault: boolean;
  autoSaveChatAsEntry: boolean;
  showSourceSnippets: boolean;
  compactMode: boolean;
  /** Whether to replay assistant responses as typewriter effect before showing Markdown */
  replayEnabled: boolean;
  /** Typewriter replay speed in words per second (default 4) */
  replaySpeed: number;
  /**
   * Knowledge mode:
   *   'strict' — evidence-only (The Sentry); answers grounded solely in pot entries
   *   'open'   — training knowledge allowed (The Navigator); model can draw on broader knowledge
   *              while still citing pot entries; labels general-knowledge answers explicitly
   */
  knowledgeMode: KnowledgeMode;
}

export const DEFAULT_SETTINGS: PotChatSettings = {
  metadataOnlyByDefault: true,
  autoSaveChatAsEntry: true,
  showSourceSnippets: true,
  compactMode: false,
  replayEnabled: true,
  replaySpeed: 4,
  knowledgeMode: 'strict',
};
