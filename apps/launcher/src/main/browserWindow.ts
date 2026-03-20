/**
 * BrowserWindow factory — Phase A
 *
 * Creates the main browser window with:
 * - Custom chrome (frame:false, custom titlebar)
 * - React renderer for the browser chrome UI
 * - TabManager for WebContentsView lifecycle
 * - SidebarManager for AI chat sidebar
 * - All IPC handlers registered
 */
import { BrowserWindow, app, session } from 'electron';
import { join } from 'path';
import { TabManager } from './tabManager.js';
import { SidebarManager } from './sidebarManager.js';
import { registerBrowserIpc, unregisterBrowserIpc } from './ipc/browserIpc.js';

let tabManagerInstance: TabManager | null = null;
let sidebarManagerInstance: SidebarManager | null = null;

export function createBrowserWindow(): BrowserWindow {
  // Allow microphone access for the Links web UI (voice mode)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  const preloadPath = join(__dirname, '../preload/index.js');

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // preload needs non-sandbox to use ipcRenderer
    },
    backgroundColor: '#0f0f1a',
    show: false, // show after content loads
  });

  // Load the chrome renderer
  const RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];
  if (RENDERER_URL) {
    win.loadURL(RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Create managers
  const tabManager = new TabManager(win);
  const sidebarManager = new SidebarManager(win, tabManager);
  tabManagerInstance = tabManager;
  sidebarManagerInstance = sidebarManager;

  // Register IPC handlers
  registerBrowserIpc(tabManager, sidebarManager, win);

  // Sidebar bounds are no longer needed — AISidebar is a React component in the renderer

  // Clean up on close
  win.on('closed', () => {
    unregisterBrowserIpc();
    tabManager.dispose();
    sidebarManager.dispose();
    tabManagerInstance = null;
    sidebarManagerInstance = null;
  });

  // Load shelf + groups from storage after API is ready
  loadPersistentState(tabManager);

  return win;
}

async function loadPersistentState(tabManager: TabManager): Promise<void> {
  const API_BASE = 'http://127.0.0.1:3000';
  try {
    const [shelfRes, groupsRes] = await Promise.all([
      fetch(`${API_BASE}/browser/shelf`),
      fetch(`${API_BASE}/browser/groups`),
    ]);
    if (shelfRes.ok) {
      const data = await shelfRes.json();
      tabManager.loadShelfFromStorage(data.items || []);
    }
    if (groupsRes.ok) {
      const data = await groupsRes.json();
      tabManager.loadGroupsFromStorage(data.groups || []);
    }
  } catch { /* API may not be ready yet — state will be empty */ }
}

export function getTabManager(): TabManager | null {
  return tabManagerInstance;
}
