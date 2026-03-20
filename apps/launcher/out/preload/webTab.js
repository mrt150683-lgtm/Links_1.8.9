"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("linksCapture", {
  /**
   * Notify the main process of a text selection (used by injected content scripts).
   * One-way: fire and forget. Main process decides what to do based on privacy mode.
   */
  notifySelection: (text, url, title) => electron.ipcRenderer.send("capture:selectionNotify", text, url, title),
  /**
   * Save current page to a Links pot (triggered by injected script on user action).
   */
  capturePage: (potId, notes) => electron.ipcRenderer.invoke("capture:page", potId, notes),
  /**
   * Save selected text to a Links pot.
   */
  captureSelection: (potId, text, notes) => electron.ipcRenderer.invoke("capture:selection", potId, text, notes)
});
