/**
 * Global type declarations for the renderer process.
 * Declares the contextBridge-exposed APIs so TypeScript knows about them.
 */

// Electron-specific CSS property for controlling window dragging behaviour.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
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

declare global {
  interface Window {
    electronAPI: {
      // Tab management
      newTab: (url?: string) => Promise<string>;
      closeTab: (tabId: string) => Promise<void>;
      switchTab: (tabId: string) => Promise<void>;
      duplicateTab: (tabId: string) => Promise<string | null>;

      // Navigation
      navigate: (tabId: string, url: string) => Promise<void>;
      goBack: (tabId: string) => Promise<void>;
      goForward: (tabId: string) => Promise<void>;
      reload: (tabId: string) => Promise<void>;
      stopLoading: (tabId: string) => Promise<void>;

      // State queries
      getTabs: () => Promise<TabState[]>;
      getActiveTabId: () => Promise<string>;

      // Shelf
      shelfTab: (tabId: string) => Promise<void>;
      getShelf: () => Promise<ShelfItem[]>;
      restoreFromShelf: (id: string) => Promise<string | null>;
      deleteFromShelf: (id: string) => Promise<void>;

      // Groups
      createGroup: (name: string, color: string, potId?: string) => Promise<string>;
      renameGroup: (id: string, name: string) => Promise<void>;
      deleteGroup: (id: string) => Promise<void>;
      assignTabToGroup: (tabId: string, groupId: string) => Promise<void>;
      removeTabFromGroup: (tabId: string) => Promise<void>;
      getGroups: () => Promise<TabGroup[]>;

      // Sidebar
      toggleSidebar: () => Promise<void>;
      loadPageContext: () => Promise<{ text: string; url: string; title: string }>;

      // View insets (push WebContentsView out of panel areas)
      setTopInset: (px: number) => Promise<void>;
      setLeftInset: (px: number) => Promise<void>;
      setRightInset: (px: number) => Promise<void>;

      // Sessions
      saveSession: (name: string) => Promise<string>;
      getSessions: () => Promise<BrowserSession[]>;
      restoreSession: (id: string) => Promise<void>;
      deleteSession: (id: string) => Promise<void>;

      // History
      getHistory: (q?: string, limit?: number) => Promise<HistoryEntry[]>;
      clearHistory: () => Promise<void>;
      promoteHistory: (id: string, potId: string) => Promise<void>;

      // Capture
      captureSelection: (tabId: string, potId: string, notes?: string) => Promise<unknown>;
      capturePage: (tabId: string, potId: string, notes?: string) => Promise<unknown>;
      captureImage: (tabId: string, imgUrl: string, potId: string, notes?: string) => Promise<unknown>;

      // Privacy
      getPrivacyMode: () => Promise<PrivacyMode>;
      setPrivacyMode: (mode: PrivacyMode) => Promise<void>;
      clearBrowsingData: () => Promise<void>;

      // Highlight buffer
      getHighlightBuffer: () => Promise<HighlightBufferEntry[]>;
      saveHighlight: (id: string, potId: string) => Promise<void>;
      discardHighlight: (id: string) => Promise<void>;
      clearHighlightBuffer: () => Promise<void>;

      // Window controls
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      isMaximized: () => Promise<boolean>;

      // Pots
      getPots: () => Promise<{ pots: Array<{ id: string; name: string }> }>;

      // Push events → returns unsubscribe function
      onTabsChanged: (cb: (tabs: TabState[]) => void) => () => void;
      onNavigationChanged: (cb: (nav: NavState) => void) => () => void;
      onShelfChanged: (cb: (shelf: ShelfItem[]) => void) => () => void;
      onGroupsChanged: (cb: (groups: TabGroup[]) => void) => () => void;
      onHighlightBufferChanged: (cb: (buf: HighlightBufferEntry[]) => void) => () => void;
      onShowCapturePicker: (cb: (opts: CapturePickerOptions) => void) => () => void;
      onTriggerQuickCapture: (cb: () => void) => () => void;
      onSidebarContextReady: (
        cb: (ctx: { text: string; url: string; title: string }) => void,
      ) => () => void;
    };
  }
}
