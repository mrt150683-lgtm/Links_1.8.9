/**
 * SidebarManager — Phase G (AI Sidebar)
 *
 * Tracks sidebar open/close state and adjusts the active WebContentsView's
 * right inset via TabManager. The actual sidebar UI is rendered as a React
 * component inside the chrome renderer (AISidebar.tsx), not as a separate
 * WebContentsView.
 */
import type { TabManager } from './tabManager.js';

const SIDEBAR_WIDTH = 360;

export class SidebarManager {
  private tabManager: TabManager;
  isOpen: boolean = false;

  constructor(_win: unknown, tabManager: TabManager) {
    this.tabManager = tabManager;
  }

  toggle(): void {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.tabManager.setRightInset(SIDEBAR_WIDTH);
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.tabManager.setRightInset(0);
  }

  /** No-op: page context is now fetched directly by the in-renderer AISidebar. */
  injectPageContext(_ctx: { text: string; url: string; title: string }): void {
    // intentionally empty — AISidebar calls loadPageContext() directly via IPC
  }

  dispose(): void {
    this.hide();
  }
}
