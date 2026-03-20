/**
 * Browser IPC handlers — all ipcMain.handle() registrations for the browser.
 *
 * Registered once per app lifecycle (after BrowserWindow + TabManager creation).
 * Phase D note: all capture handlers verify the sender is not localhost:3001
 * to prevent the chrome renderer from forging web-tab captures.
 */
import { ipcMain, globalShortcut } from 'electron';
import type { TabManager } from '../tabManager.js';
import type { SidebarManager } from '../sidebarManager.js';
import type { BrowserWindow } from 'electron';

export function registerBrowserIpc(
  tabManager: TabManager,
  sidebarManager: SidebarManager,
  win: BrowserWindow,
): void {
  // ── Tab management ──────────────────────────────────────────────────────
  ipcMain.handle('browser:newTab', (_, url?: string) => tabManager.newTab(url));
  ipcMain.handle('browser:closeTab', (_, id: string) => tabManager.closeTab(id));
  ipcMain.handle('browser:switchTab', (_, id: string) => tabManager.switchTab(id));
  ipcMain.handle('browser:duplicateTab', (_, id: string) => tabManager.duplicateTab(id));

  // ── Navigation ──────────────────────────────────────────────────────────
  ipcMain.handle('browser:navigate', (_, id: string, url: string) => tabManager.navigate(id, url));
  ipcMain.handle('browser:goBack', (_, id: string) => tabManager.goBack(id));
  ipcMain.handle('browser:goForward', (_, id: string) => tabManager.goForward(id));
  ipcMain.handle('browser:reload', (_, id: string) => tabManager.reload(id));
  ipcMain.handle('browser:stopLoading', (_, id: string) => tabManager.stopLoading(id));

  // ── State queries ────────────────────────────────────────────────────────
  ipcMain.handle('browser:getTabs', () => tabManager.getTabStateList());
  ipcMain.handle('browser:getActiveTabId', () => tabManager.getActiveTabId());

  // ── Shelf (Phase B) ──────────────────────────────────────────────────────
  ipcMain.handle('browser:shelfTab', (_, id: string) => tabManager.shelfTab(id, true));
  ipcMain.handle('browser:getShelf', () => tabManager.getShelf());
  ipcMain.handle('browser:restoreFromShelf', (_, id: string) => tabManager.restoreFromShelf(id));
  ipcMain.handle('browser:deleteFromShelf', (_, id: string) => tabManager.deleteFromShelf(id));

  // ── Groups (Phase C) ─────────────────────────────────────────────────────
  ipcMain.handle('browser:createGroup', (_, name: string, color: string, potId?: string) =>
    tabManager.createGroup(name, color, potId),
  );
  ipcMain.handle('browser:renameGroup', (_, id: string, name: string) =>
    tabManager.renameGroup(id, name),
  );
  ipcMain.handle('browser:deleteGroup', (_, id: string) => tabManager.deleteGroup(id));
  ipcMain.handle('browser:assignTabToGroup', (_, tabId: string, groupId: string) =>
    tabManager.assignTabToGroup(tabId, groupId),
  );
  ipcMain.handle('browser:removeTabFromGroup', (_, tabId: string) =>
    tabManager.removeTabFromGroup(tabId),
  );
  ipcMain.handle('browser:getGroups', () => tabManager.getGroups());

  // ── Sidebar (Phase G) ─────────────────────────────────────────────────────
  ipcMain.handle('browser:toggleSidebar', () => sidebarManager.toggle());
  ipcMain.handle('browser:loadPageContext', () => tabManager.extractPageContext());

  // ── View insets — allow renderer to expose panels above WebContentsViews ──
  // WebContentsViews are native child windows that always render on top of the
  // BrowserWindow's HTML renderer. Adjusting bounds is the only way to expose
  // HTML panels below the chrome bar.
  ipcMain.handle('browser:setTopInset', (_, px: number) => tabManager.setTopInset(px));
  ipcMain.handle('browser:setLeftInset', (_, px: number) => tabManager.setLeftInset(px));
  ipcMain.handle('browser:setRightInset', (_, px: number) => tabManager.setRightInset(px));

  // ── Capture (Phase D/E) ───────────────────────────────────────────────────
  ipcMain.handle('browser:captureSelection', async (event, tabId: string, potId: string, notes?: string) => {
    // Sender must be the chrome renderer (localhost:5173 in dev, or file:// in prod)
    const senderUrl = event.senderFrame?.url || '';
    if (senderUrl.startsWith('http://127.0.0.1:3001')) {
      throw new Error('Forbidden: capture handler cannot be triggered from web app UI');
    }
    return tabManager.captureSelection(tabId, potId, notes);
  });

  ipcMain.handle('browser:capturePage', async (event, tabId: string, potId: string, notes?: string) => {
    const senderUrl = event.senderFrame?.url || '';
    if (senderUrl.startsWith('http://127.0.0.1:3001')) {
      throw new Error('Forbidden');
    }
    return tabManager.capturePage(tabId, potId, notes);
  });

  ipcMain.handle('browser:captureImage', async (event, tabId: string, imgUrl: string, potId: string, notes?: string) => {
    const senderUrl = event.senderFrame?.url || '';
    if (senderUrl.startsWith('http://127.0.0.1:3001')) {
      throw new Error('Forbidden');
    }
    return tabManager.captureImage(tabId, imgUrl, potId, notes);
  });

  // Phase D: Capture from web tab preload
  ipcMain.handle('capture:page', async (event, potId: string, notes?: string) => {
    const senderUrl = event.senderFrame?.url || '';
    if (senderUrl.startsWith('http://127.0.0.1')) {
      throw new Error('Forbidden: web tab capture cannot originate from app origin');
    }
    // Find which tab this webContents belongs to
    const activeTabId = tabManager.getActiveTabId();
    return tabManager.capturePage(activeTabId, potId, notes);
  });

  ipcMain.handle('capture:selection', async (event, potId: string, text: string, notes?: string) => {
    const senderUrl = event.senderFrame?.url || '';
    if (senderUrl.startsWith('http://127.0.0.1')) {
      throw new Error('Forbidden');
    }
    const activeTabId = tabManager.getActiveTabId();
    return tabManager.captureSelection(activeTabId, potId, notes);
  });

  // ── Privacy (Phase I) ─────────────────────────────────────────────────────
  ipcMain.handle('browser:getPrivacyMode', () => tabManager.getPrivacyMode());
  ipcMain.handle('browser:setPrivacyMode', (_, mode) => tabManager.setPrivacyMode(mode));

  // ── Highlight buffer (Phase F) ────────────────────────────────────────────
  ipcMain.handle('browser:getHighlightBuffer', () => tabManager.getHighlightBuffer());
  ipcMain.handle('browser:saveHighlight', (_, id: string, potId: string) =>
    tabManager.saveHighlight(id, potId),
  );
  ipcMain.handle('browser:discardHighlight', (_, id: string) => tabManager.discardHighlight(id));
  ipcMain.handle('browser:clearHighlightBuffer', () => tabManager.clearHighlightBuffer());

  // ── Sessions (Phase J) ───────────────────────────────────────────────────
  ipcMain.handle('browser:saveSession', (_, name: string) => tabManager.saveSession(name));
  ipcMain.handle('browser:getSessions', () => tabManager.getSessions());
  ipcMain.handle('browser:restoreSession', (_, id: string) => tabManager.restoreSession(id));
  ipcMain.handle('browser:deleteSession', (_, id: string) => tabManager.deleteSession(id));

  // ── History (Phase K) ────────────────────────────────────────────────────
  ipcMain.handle('browser:getHistory', (_, q?: string, limit?: number) =>
    tabManager.getHistory(q, limit),
  );
  ipcMain.handle('browser:clearHistory', () => tabManager.clearHistory());
  ipcMain.handle('browser:promoteHistory', (_, id: string, potId: string) =>
    tabManager.promoteHistory(id, potId),
  );

  // ── Session data ─────────────────────────────────────────────────────────
  ipcMain.handle('browser:clearBrowsingData', () => tabManager.clearBrowsingData());

  // ── Window controls (Phase L) ─────────────────────────────────────────────
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:isMaximized', () => win.isMaximized());

  // ── Global shortcuts (Phase E) ────────────────────────────────────────────
  try {
    globalShortcut.register('CommandOrControl+Shift+S', () => {
      win.webContents.send('browser:triggerQuickCapture');
    });
  } catch { /* ignore if already registered */ }
}

export function unregisterBrowserIpc(): void {
  globalShortcut.unregister('CommandOrControl+Shift+S');
  const channels = [
    'browser:newTab', 'browser:closeTab', 'browser:switchTab', 'browser:duplicateTab',
    'browser:navigate', 'browser:goBack', 'browser:goForward', 'browser:reload',
    'browser:stopLoading', 'browser:getTabs', 'browser:getActiveTabId',
    'browser:shelfTab', 'browser:getShelf', 'browser:restoreFromShelf', 'browser:deleteFromShelf',
    'browser:createGroup', 'browser:renameGroup', 'browser:deleteGroup',
    'browser:assignTabToGroup', 'browser:removeTabFromGroup', 'browser:getGroups',
    'browser:toggleSidebar', 'browser:loadPageContext',
    'browser:setTopInset', 'browser:setLeftInset', 'browser:setRightInset',
    'browser:captureSelection', 'browser:capturePage', 'browser:captureImage',
    'capture:page', 'capture:selection',
    'browser:getPrivacyMode', 'browser:setPrivacyMode',
    'browser:getHighlightBuffer', 'browser:saveHighlight',
    'browser:discardHighlight', 'browser:clearHighlightBuffer',
    'browser:saveSession', 'browser:getSessions', 'browser:restoreSession', 'browser:deleteSession',
    'browser:getHistory', 'browser:clearHistory', 'browser:promoteHistory',
    'browser:clearBrowsingData',
    'window:minimize', 'window:maximize', 'window:close', 'window:isMaximized',
  ];
  channels.forEach((ch) => ipcMain.removeHandler(ch));
}
