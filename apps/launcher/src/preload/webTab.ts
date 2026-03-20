/**
 * Web Tab Preload (Phase D — Secure Web Tab Bridge)
 *
 * This preload runs in UNTRUSTED web tab WebContentsViews.
 * It exposes ONLY the minimal capture surface that requires user intent.
 * Web page JavaScript cannot access electronAPI — only linksCapture.
 *
 * Security guarantees:
 * - No Node.js integration (sandbox:true on the view)
 * - contextIsolation:true so page JS cannot reach this context
 * - Only IPC channels explicitly listed here are exposed
 * - Sender verification is done in the main process IPC handler
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('linksCapture', {
  /**
   * Notify the main process of a text selection (used by injected content scripts).
   * One-way: fire and forget. Main process decides what to do based on privacy mode.
   */
  notifySelection: (text: string, url: string, title: string) =>
    ipcRenderer.send('capture:selectionNotify', text, url, title),

  /**
   * Save current page to a Links pot (triggered by injected script on user action).
   */
  capturePage: (potId: string, notes?: string) =>
    ipcRenderer.invoke('capture:page', potId, notes),

  /**
   * Save selected text to a Links pot.
   */
  captureSelection: (potId: string, text: string, notes?: string) =>
    ipcRenderer.invoke('capture:selection', potId, text, notes),
});
