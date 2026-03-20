import { contextBridge, ipcRenderer } from 'electron';
import type {
  TabState,
  NavState,
  ShelfItem,
  TabGroup,
  BrowserSession,
  HistoryEntry,
  CapturePickerOptions,
  HighlightBufferEntry,
  PrivacyMode,
} from '../shared/types.js';

// Re-export types for renderer consumption
export type { TabState, NavState, ShelfItem, TabGroup, BrowserSession, HistoryEntry, PrivacyMode };

function on<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_: unknown, data: T) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Tab management ──────────────────────────────────────────────────────
  newTab: (url?: string) => ipcRenderer.invoke('browser:newTab', url),
  closeTab: (tabId: string) => ipcRenderer.invoke('browser:closeTab', tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke('browser:switchTab', tabId),
  duplicateTab: (tabId: string) => ipcRenderer.invoke('browser:duplicateTab', tabId),

  // ── Navigation ──────────────────────────────────────────────────────────
  navigate: (tabId: string, url: string) => ipcRenderer.invoke('browser:navigate', tabId, url),
  goBack: (tabId: string) => ipcRenderer.invoke('browser:goBack', tabId),
  goForward: (tabId: string) => ipcRenderer.invoke('browser:goForward', tabId),
  reload: (tabId: string) => ipcRenderer.invoke('browser:reload', tabId),
  stopLoading: (tabId: string) => ipcRenderer.invoke('browser:stopLoading', tabId),

  // ── State queries ────────────────────────────────────────────────────────
  getTabs: (): Promise<TabState[]> => ipcRenderer.invoke('browser:getTabs'),
  getActiveTabId: (): Promise<string> => ipcRenderer.invoke('browser:getActiveTabId'),

  // ── Shelf (Phase B) ──────────────────────────────────────────────────────
  shelfTab: (tabId: string) => ipcRenderer.invoke('browser:shelfTab', tabId),
  getShelf: (): Promise<ShelfItem[]> => ipcRenderer.invoke('browser:getShelf'),
  restoreFromShelf: (id: string) => ipcRenderer.invoke('browser:restoreFromShelf', id),
  deleteFromShelf: (id: string) => ipcRenderer.invoke('browser:deleteFromShelf', id),

  // ── Groups (Phase C) ─────────────────────────────────────────────────────
  createGroup: (name: string, color: string, potId?: string) =>
    ipcRenderer.invoke('browser:createGroup', name, color, potId),
  renameGroup: (id: string, name: string) => ipcRenderer.invoke('browser:renameGroup', id, name),
  deleteGroup: (id: string) => ipcRenderer.invoke('browser:deleteGroup', id),
  assignTabToGroup: (tabId: string, groupId: string) =>
    ipcRenderer.invoke('browser:assignTabToGroup', tabId, groupId),
  removeTabFromGroup: (tabId: string) => ipcRenderer.invoke('browser:removeTabFromGroup', tabId),
  getGroups: (): Promise<TabGroup[]> => ipcRenderer.invoke('browser:getGroups'),

  // ── Sidebar (Phase G) ─────────────────────────────────────────────────────
  toggleSidebar: () => ipcRenderer.invoke('browser:toggleSidebar'),
  loadPageContext: (): Promise<{ text: string; url: string; title: string }> =>
    ipcRenderer.invoke('browser:loadPageContext'),

  // ── View insets — expose HTML panels above WebContentsViews ──────────────
  setTopInset: (px: number) => ipcRenderer.invoke('browser:setTopInset', px),
  setLeftInset: (px: number) => ipcRenderer.invoke('browser:setLeftInset', px),
  setRightInset: (px: number) => ipcRenderer.invoke('browser:setRightInset', px),

  // ── Sessions (Phase J) ───────────────────────────────────────────────────
  saveSession: (name: string): Promise<string> => ipcRenderer.invoke('browser:saveSession', name),
  getSessions: (): Promise<BrowserSession[]> => ipcRenderer.invoke('browser:getSessions'),
  restoreSession: (id: string) => ipcRenderer.invoke('browser:restoreSession', id),
  deleteSession: (id: string) => ipcRenderer.invoke('browser:deleteSession', id),

  // ── History (Phase K) ────────────────────────────────────────────────────
  getHistory: (q?: string, limit?: number): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('browser:getHistory', q, limit),
  clearHistory: () => ipcRenderer.invoke('browser:clearHistory'),
  promoteHistory: (id: string, potId: string) => ipcRenderer.invoke('browser:promoteHistory', id, potId),

  // ── Capture (Phase D/E) ───────────────────────────────────────────────────
  captureSelection: (tabId: string, potId: string, notes?: string) =>
    ipcRenderer.invoke('browser:captureSelection', tabId, potId, notes),
  capturePage: (tabId: string, potId: string, notes?: string) =>
    ipcRenderer.invoke('browser:capturePage', tabId, potId, notes),
  captureImage: (tabId: string, imgUrl: string, potId: string, notes?: string) =>
    ipcRenderer.invoke('browser:captureImage', tabId, imgUrl, potId, notes),

  // ── Privacy (Phase I) ─────────────────────────────────────────────────────
  getPrivacyMode: (): Promise<PrivacyMode> => ipcRenderer.invoke('browser:getPrivacyMode'),
  setPrivacyMode: (mode: PrivacyMode) => ipcRenderer.invoke('browser:setPrivacyMode', mode),
  clearBrowsingData: (): Promise<void> => ipcRenderer.invoke('browser:clearBrowsingData'),

  // ── Highlight buffer (Phase F) ────────────────────────────────────────────
  getHighlightBuffer: (): Promise<HighlightBufferEntry[]> =>
    ipcRenderer.invoke('browser:getHighlightBuffer'),
  saveHighlight: (id: string, potId: string) => ipcRenderer.invoke('browser:saveHighlight', id, potId),
  discardHighlight: (id: string) => ipcRenderer.invoke('browser:discardHighlight', id),
  clearHighlightBuffer: () => ipcRenderer.invoke('browser:clearHighlightBuffer'),

  // ── Window controls (Phase L) ─────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  // ── Pots (for capture picker) ─────────────────────────────────────────────
  getPots: () =>
    fetch('http://127.0.0.1:3000/pots').then((r) => r.json()),

  // ── Push events from main → renderer ────────────────────────────────────
  onTabsChanged: (cb: (tabs: TabState[]) => void) => on('browser:tabsChanged', cb),
  onNavigationChanged: (cb: (nav: NavState) => void) => on('browser:navigationChanged', cb),
  onShelfChanged: (cb: (shelf: ShelfItem[]) => void) => on('browser:shelfChanged', cb),
  onGroupsChanged: (cb: (groups: TabGroup[]) => void) => on('browser:groupsChanged', cb),
  onHighlightBufferChanged: (cb: (buf: HighlightBufferEntry[]) => void) =>
    on('browser:highlightBufferChanged', cb),
  onShowCapturePicker: (cb: (opts: CapturePickerOptions) => void) =>
    on('browser:showCapturePicker', cb),
  onTriggerQuickCapture: (cb: () => void) => on('browser:triggerQuickCapture', cb),
  onSidebarContextReady: (cb: (ctx: { text: string; url: string; title: string }) => void) =>
    on('browser:sidebarContextReady', cb),
});
