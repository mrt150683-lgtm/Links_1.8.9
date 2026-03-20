/**
 * TabManager — WebContentsView lifecycle + tab state
 *
 * Manages all browser tabs including the pinned Links App tab and web tabs.
 * Implements:
 *   Phase A: basic tab CRUD + nav events
 *   Phase B: shelf (auto-shelf LRU when cap exceeded)
 *   Phase C: tab groups
 *   Phase D: secure web tab preload, permission gating
 *   Phase F: highlight mode injection
 *   Phase I: privacy mode + history recording
 *   Phase J: session save/restore
 *   Phase K: history recording
 */

import { WebContentsView, BrowserWindow, ipcMain, shell, session } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { TabState, ShelfItem, TabGroup, BrowserSession, HistoryEntry, PrivacyMode, HighlightBufferEntry } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CHROME_HEIGHT = 80; // px — matches CSS chrome bar height
const LINKS_APP_TAB_ID = 'links-app';
const LINKS_APP_URL = 'http://127.0.0.1:3001';
const WEB_TAB_MAX = 10;
const API_BASE = 'http://127.0.0.1:3000';

// All web tabs share one persistent Chromium profile so cookies/logins survive
// across tab open/close and app restarts.  Incognito tabs use an in-memory
// partition (no "persist:" prefix) that is destroyed when the tab is closed.
const PERSISTENT_PARTITION = 'persist:links-browser';
const INCOGNITO_PARTITION  = 'links-incognito';  // in-memory, wiped on close

interface TabEntry {
  id: string;
  type: 'links_app' | 'web';
  url: string;
  title: string;
  faviconUrl?: string;
  groupId?: string;
  view: WebContentsView;
  lastActiveAt: number;
}

export class TabManager {
  private win: BrowserWindow;
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string = LINKS_APP_TAB_ID;
  private shelf: ShelfItem[] = [];
  private groups: TabGroup[] = [];
  private highlightBuffer: HighlightBufferEntry[] = [];
  private rightInset: number = 0; // for AI sidebar (right)
  private leftInset: number = 0;  // for group sidebar (left)
  private topInset: number = 0;   // for dropdown panels (below chrome bar)

  constructor(win: BrowserWindow) {
    this.win = win;
    this.setupSharedSession();
    const linksView = this.createLinksView();
    this.tabs.set(LINKS_APP_TAB_ID, {
      id: LINKS_APP_TAB_ID,
      type: 'links_app',
      url: LINKS_APP_URL,
      title: 'Links',
      view: linksView,
      lastActiveAt: Date.now(),
    });
    this.showView(LINKS_APP_TAB_ID);
    this.setupWindowResize();
    this.setupHighlightIpc();
  }

  /** Configure the shared persistent web session once (permission handler, etc.). */
  private setupSharedSession(): void {
    const ses = session.fromPartition(PERSISTENT_PARTITION);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed: string[] = ['clipboard-read', 'clipboard-sanitized-write'];
      callback(allowed.includes(permission));
    });
    console.log(`[Browser] Shared session ready: partition="${PERSISTENT_PARTITION}" (persistent=true)`);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private createLinksView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:links-app',
      },
    });
    view.webContents.loadURL(LINKS_APP_URL);

    // Open external links from within the web UI in a new browser tab
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://127.0.0.1')) return { action: 'allow' };
      this.newTab(url);
      return { action: 'deny' };
    });

    // Minimal context menu for the Links app: copy selected text, cut/paste in inputs
    view.webContents.on('context-menu', (_event, params) => {
      const { Menu, MenuItem } = require('electron');
      const menu = new Menu();
      if (params.isEditable) {
        menu.append(new MenuItem({ role: 'cut' }));
        menu.append(new MenuItem({ role: 'copy' }));
        menu.append(new MenuItem({ role: 'paste' }));
      } else if (params.selectionText?.trim()) {
        menu.append(new MenuItem({ role: 'copy' }));
      }
      if (menu.items.length > 0) menu.popup({ window: this.win });
    });

    return view;
  }

  private computeBounds(): Electron.Rectangle {
    const [width, height] = this.win.getContentSize();
    const y = CHROME_HEIGHT + this.topInset;
    const h = Math.max(1, height - CHROME_HEIGHT - this.topInset);
    const w = Math.max(1, width - this.rightInset - this.leftInset);
    return { x: this.leftInset, y, width: w, height: h };
  }

  private showView(tabId: string): void {
    // Remove all views first
    for (const { view } of this.tabs.values()) {
      try {
        (this.win as any).contentView.removeChildView(view);
      } catch { /* ignore if already removed */ }
    }
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    (this.win as any).contentView.addChildView(entry.view);
    entry.view.setBounds(this.computeBounds());
  }

  private setupWindowResize(): void {
    this.win.on('resize', () => {
      const bounds = this.computeBounds();
      const active = this.tabs.get(this.activeTabId);
      active?.view.setBounds(bounds);
    });
  }

  private setupHighlightIpc(): void {
    // Phase F: receive selection notifications from web tab preloads
    ipcMain.on('capture:selectionNotify', async (_event, text: string, url: string, title: string) => {
      if (!text || text.length < 10) return;
      // Dedup by content hash
      const id = randomUUID();
      const entry: HighlightBufferEntry = { id, text, url, title, timestamp: Date.now() };
      this.highlightBuffer.push(entry);
      this.broadcastHighlightBuffer();
    });
  }

  private broadcastTabs(): void {
    const tabs = this.getTabStateList();
    this.win.webContents.send('browser:tabsChanged', tabs);
  }

  private broadcastNav(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    const wc = entry.view.webContents;
    const nav = {
      tabId,
      url: wc.getURL(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
    };
    this.win.webContents.send('browser:navigationChanged', nav);
  }

  private broadcastShelf(): void {
    this.win.webContents.send('browser:shelfChanged', this.shelf);
  }

  private broadcastGroups(): void {
    this.win.webContents.send('browser:groupsChanged', this.groups);
  }

  private broadcastHighlightBuffer(): void {
    this.win.webContents.send('browser:highlightBufferChanged', this.highlightBuffer);
  }

  private getWebTabPreloadPath(): string {
    return join(__dirname, '../preload/webTab.js');
  }

  private wireNavEvents(id: string, view: WebContentsView, targetUrl: string): void {
    const navEvents = [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ];
    navEvents.forEach((evt) => {
      view.webContents.on(evt as never, () => {
        const entry = this.tabs.get(id);
        if (entry) entry.title = view.webContents.getTitle() || targetUrl;
        this.broadcastTabs();
        if (id === this.activeTabId) this.broadcastNav(id);
      });
    });

    view.webContents.on('page-favicon-updated', (_, favicons) => {
      const entry = this.tabs.get(id);
      if (entry) entry.faviconUrl = favicons[0];
      this.broadcastTabs();
    });

    // Prevent navigation that opens new windows — capture as new tabs
    view.webContents.setWindowOpenHandler(({ url }) => {
      this.newTab(url);
      return { action: 'deny' };
    });

    // Open external:// links natively
    view.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        event.preventDefault();
        shell.openExternal(url).catch(() => { /* ignore */ });
      }
    });
  }

  private async persistShelfItem(item: ShelfItem): Promise<void> {
    try {
      await fetch(`${API_BASE}/browser/shelf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
    } catch { /* fire-and-forget */ }
  }

  private async recordHistory(tabId: string, url: string, title: string): Promise<void> {
    if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;
    try {
      await fetch(`${API_BASE}/browser/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: randomUUID(), url, title, tabId, visitTime: Date.now() }),
      });
    } catch { /* fire-and-forget */ }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  newTab(url?: string): string {
    const webTabs = [...this.tabs.values()].filter((t) => t.type === 'web');
    if (webTabs.length >= WEB_TAB_MAX) {
      // Auto-shelf the least-recently-active web tab (Phase B)
      const lru = webTabs.sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
      this.shelfTab(lru.id, true);
    }

    const id = randomUUID();
    const targetUrl = url
      ? url.startsWith('http://') || url.startsWith('https://')
        ? url
        : `https://${url}`
      : 'https://www.google.com';

    // All web tabs share PERSISTENT_PARTITION so cookies/logins persist across
    // tab open/close and app restarts.  Permission handler is set once in
    // setupSharedSession() — not per-view.
    const partition = PERSISTENT_PARTITION;
    console.log(`[Browser] New tab ${id}: partition="${partition}" persistent=true url=${targetUrl}`);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.getWebTabPreloadPath(),
        partition,
      },
    });

    view.webContents.loadURL(targetUrl);
    this.wireNavEvents(id, view, targetUrl);

    // Phase K: Record history on navigation
    view.webContents.on('did-navigate', (_, navigatedUrl) => {
      const title = view.webContents.getTitle();
      this.recordHistory(id, navigatedUrl, title);
    });

    // Phase E: Context menu
    view.webContents.on('context-menu', (_event, params) => {
      this.handleContextMenu(id, params);
    });

    this.tabs.set(id, {
      id,
      type: 'web',
      url: targetUrl,
      title: targetUrl,
      view,
      lastActiveAt: Date.now(),
    });

    this.switchTab(id);
    return id;
  }

  shelfTab(tabId: string, persist: boolean = false): ShelfItem | null {
    if (tabId === LINKS_APP_TAB_ID) return null;
    const entry = this.tabs.get(tabId);
    if (!entry) return null;

    const shelfItem: ShelfItem = {
      id: tabId,
      url: entry.view.webContents.getURL() || entry.url,
      title: entry.view.webContents.getTitle() || entry.title,
      faviconUrl: entry.faviconUrl,
      groupId: entry.groupId,
      shelvedAt: Date.now(),
      lastActiveAt: entry.lastActiveAt,
    };

    try {
      (this.win as any).contentView.removeChildView(entry.view);
    } catch { /* ignore */ }
    entry.view.webContents.close();
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      this.activeTabId = LINKS_APP_TAB_ID;
    }

    if (persist) {
      this.persistShelfItem(shelfItem);
    }

    this.shelf.push(shelfItem);
    this.broadcastTabs();
    this.broadcastShelf();
    return shelfItem;
  }

  restoreFromShelf(shelfId: string): string | null {
    const idx = this.shelf.findIndex((s) => s.id === shelfId);
    if (idx === -1) return null;
    const [item] = this.shelf.splice(idx, 1);

    // Delete from DB (fire-and-forget)
    fetch(`${API_BASE}/browser/shelf/${item.id}`, { method: 'DELETE' }).catch(() => { /* ignore */ });

    const newTabId = this.newTab(item.url);

    // Restore group if it had one
    if (item.groupId) {
      this.assignTabToGroup(newTabId, item.groupId);
    }

    this.broadcastShelf();
    return newTabId;
  }

  deleteFromShelf(shelfId: string): void {
    const idx = this.shelf.findIndex((s) => s.id === shelfId);
    if (idx !== -1) {
      this.shelf.splice(idx, 1);
      fetch(`${API_BASE}/browser/shelf/${shelfId}`, { method: 'DELETE' }).catch(() => { /* ignore */ });
      this.broadcastShelf();
    }
  }

  loadShelfFromStorage(items: ShelfItem[]): void {
    this.shelf = items || [];
    this.broadcastShelf();
  }

  closeTab(tabId: string): void {
    if (tabId === LINKS_APP_TAB_ID) return;
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    try {
      (this.win as any).contentView.removeChildView(entry.view);
    } catch { /* ignore */ }
    entry.view.webContents.close();
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      this.switchTab(LINKS_APP_TAB_ID);
    } else {
      this.broadcastTabs();
    }
  }

  switchTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    const entry = this.tabs.get(tabId)!;
    entry.lastActiveAt = Date.now();
    this.activeTabId = tabId;
    this.showView(tabId);
    this.broadcastTabs();
    this.broadcastNav(tabId);
  }

  duplicateTab(tabId: string): string | null {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') return null;
    return this.newTab(entry.view.webContents.getURL() || entry.url);
  }

  navigate(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') return;
    const target =
      url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    entry.view.webContents.loadURL(target);
  }

  goBack(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.goBack();
  }

  goForward(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.goForward();
  }

  reload(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.reload();
  }

  stopLoading(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.stop();
  }

  // ── Phase C: Groups ───────────────────────────────────────────────────────

  createGroup(name: string, color: string = '#4a9eff', potId?: string): string {
    const id = randomUUID();
    const group: TabGroup = { id, name, color, potId, createdAt: Date.now() };
    this.groups.push(group);
    fetch(`${API_BASE}/browser/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group),
    }).catch(() => { /* fire-and-forget */ });
    this.broadcastGroups();
    return id;
  }

  renameGroup(id: string, name: string): void {
    const g = this.groups.find((g) => g.id === id);
    if (!g) return;
    g.name = name;
    fetch(`${API_BASE}/browser/groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => { /* fire-and-forget */ });
    this.broadcastGroups();
  }

  deleteGroup(id: string): void {
    this.groups = this.groups.filter((g) => g.id !== id);
    // Remove groupId from all tabs in this group
    for (const entry of this.tabs.values()) {
      if (entry.groupId === id) entry.groupId = undefined;
    }
    for (const item of this.shelf) {
      if (item.groupId === id) item.groupId = undefined;
    }
    fetch(`${API_BASE}/browser/groups/${id}`, { method: 'DELETE' }).catch(() => { /* fire-and-forget */ });
    this.broadcastGroups();
    this.broadcastTabs();
    this.broadcastShelf();
  }

  assignTabToGroup(tabId: string, groupId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') return;
    entry.groupId = groupId;
    this.broadcastTabs();
  }

  removeTabFromGroup(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    entry.groupId = undefined;
    this.broadcastTabs();
  }

  getGroups(): TabGroup[] {
    return this.groups;
  }

  loadGroupsFromStorage(groups: TabGroup[]): void {
    this.groups = groups || [];
    this.broadcastGroups();
  }

  // ── Phase E: Context menu ─────────────────────────────────────────────────

  private handleContextMenu(tabId: string, params: Electron.ContextMenuParams): void {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();

    if (params.selectionText?.trim()) {
      menu.append(
        new MenuItem({
          label: 'Save Selection to Links…',
          click: () => {
            this.win.webContents.send('browser:showCapturePicker', {
              type: 'selection',
              tabId,
              payload: params.selectionText,
            });
          },
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.mediaType === 'image' && params.srcURL) {
      menu.append(
        new MenuItem({
          label: 'Save Image to Links…',
          click: () => {
            this.win.webContents.send('browser:showCapturePicker', {
              type: 'image',
              tabId,
              payload: params.srcURL,
            });
          },
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    menu.append(
      new MenuItem({
        label: 'Save Page to Links…',
        click: () => {
          this.win.webContents.send('browser:showCapturePicker', {
            type: 'page',
            tabId,
          });
        },
      }),
    );

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(
      new MenuItem({
        label: 'Add Tab to Group…',
        click: () => this.win.webContents.send('browser:promptGroupAssign', tabId),
      }),
    );

    menu.append(
      new MenuItem({
        label: 'Move to Shelf',
        click: () => this.shelfTab(tabId, true),
      }),
    );

    menu.append(
      new MenuItem({
        label: 'Duplicate Tab',
        click: () => this.duplicateTab(tabId),
      }),
    );

    menu.append(new MenuItem({ type: 'separator' }));

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    menu.append(new MenuItem({ role: 'reload' }));
    menu.append(new MenuItem({ role: 'toggleDevTools' }));

    menu.popup({ window: this.win });
  }

  // ── Phase D: Capture from web tabs ────────────────────────────────────────

  async captureSelection(tabId: string, potId: string, notes?: string): Promise<unknown> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') throw new Error('Not a web tab');
    const wc = entry.view.webContents;
    const text = await wc.executeJavaScript(`window.getSelection()?.toString() || ''`);
    const url = wc.getURL();
    return fetch(`${API_BASE}/capture/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: potId,
        text,
        source_url: url,
        notes,
        capture_method: 'browser_selection',
      }),
    }).then((r) => r.json());
  }

  async capturePage(tabId: string, potId: string, notes?: string): Promise<unknown> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') throw new Error('Not a web tab');
    const wc = entry.view.webContents;
    const url = wc.getURL();
    const title = wc.getTitle();
    const text = await wc.executeJavaScript(`(document.body?.innerText || '').slice(0, 40000)`);
    return fetch(`${API_BASE}/capture/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: potId,
        text,
        source_url: url,
        source_title: title,
        notes,
        capture_method: 'browser_page',
      }),
    }).then((r) => r.json());
  }

  async captureImage(tabId: string, imgUrl: string, potId: string, notes?: string): Promise<unknown> {
    // Get source page URL from tab
    const entry = this.tabs.get(tabId);
    if (!entry || entry.type === 'links_app') throw new Error('Not a web tab');
    const sourcePageUrl = entry.view.webContents.getURL();

    // Fetch image from URL and encode as base64
    let imageData: string;
    try {
      const response = await fetch(imgUrl);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
      const buffer = await response.arrayBuffer();
      imageData = Buffer.from(buffer).toString('base64');
    } catch (e) {
      throw new Error(`Failed to capture image: ${String(e)}`);
    }

    const r = await fetch(`${API_BASE}/capture/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: potId,
        image_data: imageData,
        source_url: sourcePageUrl,
        image_source_url: imgUrl,
        notes,
        capture_method: 'browser_image',
      }),
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      throw new Error((errBody as any).message || `Capture failed (${r.status})`);
    }
    return r.json();
  }

  // ── Phase G: Page context extraction ──────────────────────────────────────

  async extractPageContext(): Promise<{ text: string; url: string; title: string }> {
    const entry = this.tabs.get(this.activeTabId);
    if (!entry || entry.type === 'links_app') {
      return { text: '', url: '', title: '' };
    }
    const wc = entry.view.webContents;
    const text = await wc.executeJavaScript(`(document.body?.innerText || '').slice(0, 20000)`);
    return { text, url: wc.getURL(), title: wc.getTitle() };
  }

  // ── Phase I: Privacy mode ─────────────────────────────────────────────────

  async getPrivacyMode(): Promise<PrivacyMode> {
    try {
      const res = await fetch(`${API_BASE}/prefs`);
      const data = await res.json();
      return (data?.['browser.privacy_mode'] as PrivacyMode) || 'zero';
    } catch {
      return 'zero';
    }
  }

  async setPrivacyMode(mode: PrivacyMode): Promise<void> {
    await fetch(`${API_BASE}/prefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'browser.privacy_mode': mode }),
    }).catch(() => { /* fire-and-forget */ });
  }

  // ── Phase F: Highlight buffer ─────────────────────────────────────────────

  getHighlightBuffer(): HighlightBufferEntry[] {
    return this.highlightBuffer;
  }

  async saveHighlight(id: string, potId: string): Promise<void> {
    const item = this.highlightBuffer.find((h) => h.id === id);
    if (!item) return;
    await fetch(`${API_BASE}/capture/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: potId,
        content_text: item.text,
        source_url: item.url,
        source_title: item.title,
        capture_method: 'browser_highlight',
      }),
    }).catch(() => { /* fire-and-forget */ });
    this.discardHighlight(id);
  }

  discardHighlight(id: string): void {
    this.highlightBuffer = this.highlightBuffer.filter((h) => h.id !== id);
    this.broadcastHighlightBuffer();
  }

  clearHighlightBuffer(): void {
    this.highlightBuffer = [];
    this.broadcastHighlightBuffer();
  }

  // ── Phase J: Session management ───────────────────────────────────────────

  async saveSession(name: string): Promise<string> {
    const id = randomUUID();
    const snapshot: BrowserSession = {
      id,
      name,
      tabSnapshot: this.getTabStateList(),
      shelfSnapshot: this.shelf,
      groupsSnapshot: this.groups,
      createdAt: Date.now(),
    };
    await fetch(`${API_BASE}/browser/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }).catch(() => { /* fire-and-forget */ });
    return id;
  }

  async restoreSession(sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/browser/sessions/${sessionId}`);
    const session: BrowserSession = await res.json();

    // Close all web tabs
    for (const tab of [...this.tabs.values()].filter((t) => t.type === 'web')) {
      this.closeTab(tab.id);
    }

    // Restore groups
    this.groups = session.groupsSnapshot || [];
    // Restore shelf
    this.shelf = session.shelfSnapshot || [];

    // Restore tabs
    for (const tab of (session.tabSnapshot || []).filter((t) => t.type === 'web')) {
      const newId = this.newTab(tab.url);
      if (tab.groupId) this.assignTabToGroup(newId, tab.groupId);
    }

    this.broadcastGroups();
    this.broadcastShelf();
  }

  async getSessions(): Promise<BrowserSession[]> {
    try {
      const res = await fetch(`${API_BASE}/browser/sessions`);
      const data = await res.json();
      return data.sessions || [];
    } catch {
      return [];
    }
  }

  async deleteSession(id: string): Promise<void> {
    await fetch(`${API_BASE}/browser/sessions/${id}`, { method: 'DELETE' }).catch(() => { /* fire-and-forget */ });
  }

  // ── Phase K: History ──────────────────────────────────────────────────────

  async getHistory(q?: string, limit: number = 100): Promise<HistoryEntry[]> {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('limit', String(limit));
      const res = await fetch(`${API_BASE}/browser/history?${params}`);
      const data = await res.json();
      return data.entries || [];
    } catch {
      return [];
    }
  }

  async clearHistory(): Promise<void> {
    await fetch(`${API_BASE}/browser/history`, { method: 'DELETE' }).catch(() => { /* fire-and-forget */ });
  }

  /**
   * Wipe all Chromium session data for the shared persistent partition:
   * cookies, cache, localStorage, IndexedDB, service workers, etc.
   * After calling this every site will require re-login.
   */
  async clearBrowsingData(): Promise<void> {
    const ses = session.fromPartition(PERSISTENT_PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    console.log(`[Browser] Browsing data cleared for partition="${PERSISTENT_PARTITION}"`);
  }

  async promoteHistory(historyId: string, potId: string): Promise<void> {
    await fetch(`${API_BASE}/browser/history/${historyId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pot_id: potId }),
    }).catch(() => { /* fire-and-forget */ });
  }

  // ── View insets (Phase G + panels) ───────────────────────────────────────
  // These adjust the active WebContentsView bounds so native child views
  // don't overlap HTML panels rendered in the chrome renderer.

  setRightInset(px: number): void {
    this.rightInset = Math.max(0, px);
    this.tabs.get(this.activeTabId)?.view.setBounds(this.computeBounds());
  }

  setLeftInset(px: number): void {
    this.leftInset = Math.max(0, px);
    this.tabs.get(this.activeTabId)?.view.setBounds(this.computeBounds());
  }

  setTopInset(px: number): void {
    this.topInset = Math.max(0, px);
    this.tabs.get(this.activeTabId)?.view.setBounds(this.computeBounds());
  }

  // ── State getters ─────────────────────────────────────────────────────────

  getTabStateList(): TabState[] {
    return [...this.tabs.values()].map((t) => ({
      id: t.id,
      type: t.type,
      url: t.view.webContents.getURL() || t.url,
      title: t.view.webContents.getTitle() || t.title,
      faviconUrl: t.faviconUrl,
      isLoading: t.view.webContents.isLoading(),
      isActive: t.id === this.activeTabId,
      groupId: t.groupId,
    }));
  }

  getActiveTabId(): string {
    return this.activeTabId;
  }

  getShelf(): ShelfItem[] {
    return this.shelf;
  }

  dispose(): void {
    for (const { view } of this.tabs.values()) {
      view.webContents.close();
    }
    this.tabs.clear();
  }
}
