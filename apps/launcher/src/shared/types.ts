/**
 * Shared types between preload and renderer.
 * Must have NO imports from Electron, Node.js, or any non-standard module
 * so they can safely be used in both build targets.
 */

export interface TabState {
  id: string;
  type: 'links_app' | 'web';
  url: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  isActive: boolean;
  groupId?: string;
}

export interface NavState {
  tabId: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface ShelfItem {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  groupId?: string;
  note?: string;
  shelvedAt: number;
  lastActiveAt?: number;
}

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  potId?: string;
  createdAt: number;
}

export interface BrowserSession {
  id: string;
  name: string;
  tabSnapshot: TabState[];
  shelfSnapshot: ShelfItem[];
  groupsSnapshot: TabGroup[];
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  tabId?: string;
}

export interface CapturePickerOptions {
  type: 'page' | 'selection' | 'image';
  tabId: string;
  payload?: string; // text for selection, srcURL for image
}

export interface HighlightBufferEntry {
  id: string;
  text: string;
  url: string;
  title: string;
  timestamp: number;
}

export type PrivacyMode = 'zero' | 'review' | 'full';
