"use strict";
const electron = require("electron");
function on(channel, cb) {
  const listener = (_, data) => cb(data);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
}
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // ── Tab management ──────────────────────────────────────────────────────
  newTab: (url) => electron.ipcRenderer.invoke("browser:newTab", url),
  closeTab: (tabId) => electron.ipcRenderer.invoke("browser:closeTab", tabId),
  switchTab: (tabId) => electron.ipcRenderer.invoke("browser:switchTab", tabId),
  duplicateTab: (tabId) => electron.ipcRenderer.invoke("browser:duplicateTab", tabId),
  // ── Navigation ──────────────────────────────────────────────────────────
  navigate: (tabId, url) => electron.ipcRenderer.invoke("browser:navigate", tabId, url),
  goBack: (tabId) => electron.ipcRenderer.invoke("browser:goBack", tabId),
  goForward: (tabId) => electron.ipcRenderer.invoke("browser:goForward", tabId),
  reload: (tabId) => electron.ipcRenderer.invoke("browser:reload", tabId),
  stopLoading: (tabId) => electron.ipcRenderer.invoke("browser:stopLoading", tabId),
  // ── State queries ────────────────────────────────────────────────────────
  getTabs: () => electron.ipcRenderer.invoke("browser:getTabs"),
  getActiveTabId: () => electron.ipcRenderer.invoke("browser:getActiveTabId"),
  // ── Shelf (Phase B) ──────────────────────────────────────────────────────
  shelfTab: (tabId) => electron.ipcRenderer.invoke("browser:shelfTab", tabId),
  getShelf: () => electron.ipcRenderer.invoke("browser:getShelf"),
  restoreFromShelf: (id) => electron.ipcRenderer.invoke("browser:restoreFromShelf", id),
  deleteFromShelf: (id) => electron.ipcRenderer.invoke("browser:deleteFromShelf", id),
  // ── Groups (Phase C) ─────────────────────────────────────────────────────
  createGroup: (name, color, potId) => electron.ipcRenderer.invoke("browser:createGroup", name, color, potId),
  renameGroup: (id, name) => electron.ipcRenderer.invoke("browser:renameGroup", id, name),
  deleteGroup: (id) => electron.ipcRenderer.invoke("browser:deleteGroup", id),
  assignTabToGroup: (tabId, groupId) => electron.ipcRenderer.invoke("browser:assignTabToGroup", tabId, groupId),
  removeTabFromGroup: (tabId) => electron.ipcRenderer.invoke("browser:removeTabFromGroup", tabId),
  getGroups: () => electron.ipcRenderer.invoke("browser:getGroups"),
  // ── Sidebar (Phase G) ─────────────────────────────────────────────────────
  toggleSidebar: () => electron.ipcRenderer.invoke("browser:toggleSidebar"),
  loadPageContext: () => electron.ipcRenderer.invoke("browser:loadPageContext"),
  // ── View insets — expose HTML panels above WebContentsViews ──────────────
  setTopInset: (px) => electron.ipcRenderer.invoke("browser:setTopInset", px),
  setLeftInset: (px) => electron.ipcRenderer.invoke("browser:setLeftInset", px),
  setRightInset: (px) => electron.ipcRenderer.invoke("browser:setRightInset", px),
  // ── Sessions (Phase J) ───────────────────────────────────────────────────
  saveSession: (name) => electron.ipcRenderer.invoke("browser:saveSession", name),
  getSessions: () => electron.ipcRenderer.invoke("browser:getSessions"),
  restoreSession: (id) => electron.ipcRenderer.invoke("browser:restoreSession", id),
  deleteSession: (id) => electron.ipcRenderer.invoke("browser:deleteSession", id),
  // ── History (Phase K) ────────────────────────────────────────────────────
  getHistory: (q, limit) => electron.ipcRenderer.invoke("browser:getHistory", q, limit),
  clearHistory: () => electron.ipcRenderer.invoke("browser:clearHistory"),
  promoteHistory: (id, potId) => electron.ipcRenderer.invoke("browser:promoteHistory", id, potId),
  // ── Capture (Phase D/E) ───────────────────────────────────────────────────
  captureSelection: (tabId, potId, notes) => electron.ipcRenderer.invoke("browser:captureSelection", tabId, potId, notes),
  capturePage: (tabId, potId, notes) => electron.ipcRenderer.invoke("browser:capturePage", tabId, potId, notes),
  captureImage: (tabId, imgUrl, potId, notes) => electron.ipcRenderer.invoke("browser:captureImage", tabId, imgUrl, potId, notes),
  // ── Privacy (Phase I) ─────────────────────────────────────────────────────
  getPrivacyMode: () => electron.ipcRenderer.invoke("browser:getPrivacyMode"),
  setPrivacyMode: (mode) => electron.ipcRenderer.invoke("browser:setPrivacyMode", mode),
  clearBrowsingData: () => electron.ipcRenderer.invoke("browser:clearBrowsingData"),
  // ── Highlight buffer (Phase F) ────────────────────────────────────────────
  getHighlightBuffer: () => electron.ipcRenderer.invoke("browser:getHighlightBuffer"),
  saveHighlight: (id, potId) => electron.ipcRenderer.invoke("browser:saveHighlight", id, potId),
  discardHighlight: (id) => electron.ipcRenderer.invoke("browser:discardHighlight", id),
  clearHighlightBuffer: () => electron.ipcRenderer.invoke("browser:clearHighlightBuffer"),
  // ── Window controls (Phase L) ─────────────────────────────────────────────
  minimizeWindow: () => electron.ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => electron.ipcRenderer.invoke("window:maximize"),
  closeWindow: () => electron.ipcRenderer.invoke("window:close"),
  isMaximized: () => electron.ipcRenderer.invoke("window:isMaximized"),
  // ── Pots (for capture picker) ─────────────────────────────────────────────
  getPots: () => fetch("http://127.0.0.1:3000/pots").then((r) => r.json()),
  // ── Push events from main → renderer ────────────────────────────────────
  onTabsChanged: (cb) => on("browser:tabsChanged", cb),
  onNavigationChanged: (cb) => on("browser:navigationChanged", cb),
  onShelfChanged: (cb) => on("browser:shelfChanged", cb),
  onGroupsChanged: (cb) => on("browser:groupsChanged", cb),
  onHighlightBufferChanged: (cb) => on("browser:highlightBufferChanged", cb),
  onShowCapturePicker: (cb) => on("browser:showCapturePicker", cb),
  onTriggerQuickCapture: (cb) => on("browser:triggerQuickCapture", cb),
  onSidebarContextReady: (cb) => on("browser:sidebarContextReady", cb)
});
