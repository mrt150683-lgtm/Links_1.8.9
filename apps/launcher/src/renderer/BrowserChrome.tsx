/**
 * BrowserChrome — Root renderer component.
 *
 * Renders the 80px chrome bar fixed at the top of the window.
 * WebContentsViews (actual web pages) sit beneath this as Electron child views
 * and are managed entirely by the main process TabManager.
 *
 * Layout (80px total):
 *   Row 1 (36px): ☰ Groups | TabStrip | WindowControls
 *   Row 2 (44px): NavButtons | AddressBar | CaptureToolbar | [panels row]
 *
 * Right sidebar: unified 360px panel (ai, shelf, sessions, history, highlights, privacy)
 * Group sidebar: 240px left panel (collapses when Links App tab is active)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import sidebarIcon from './assets/icons/sidebar.png';
import { WindowControls } from './components/WindowControls.js';
import { TabStrip } from './components/TabStrip.js';
import { NavButtons } from './components/NavButtons.js';
import { AddressBar } from './components/AddressBar.js';
import { CaptureToolbar } from './components/CaptureToolbar.js';
import { GroupSidebar } from './components/GroupSidebar.js';
import { CapturePicker } from './components/CapturePicker.js';
import { RightSidebar } from './components/RightSidebar.js';
import type { RightMode } from './components/RightSidebar.js';
import { useTabs } from './hooks/useTabs.js';
import { useNavigation } from './hooks/useNavigation.js';
import type { CapturePickerOptions, TabGroup, PrivacyMode } from '../shared/types.js';

const CHROME_HEIGHT = 80;
const GROUP_SIDEBAR_WIDTH = 240;
const RIGHT_SIDEBAR_WIDTH = 360;


export default function BrowserChrome() {
  const { tabs, activeTab } = useTabs();
  const nav = useNavigation(activeTab?.id ?? null);

  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [groupSidebarOpen, setGroupSidebarOpen] = useState(false);
  const [rightMode, setRightMode] = useState<RightMode | null>(null);
  const [capturePickerOpts, setCapturePickerOpts] = useState<CapturePickerOptions | null>(null);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('zero');
  const [shelfCount, setShelfCount] = useState(0);
  const [highlightCount, setHighlightCount] = useState(0);
  const lastRightMode = useRef<RightMode>('ai');

  // Load groups
  useEffect(() => {
    window.electronAPI.getGroups().then(setGroups).catch(() => { /* ignore */ });
    const unsub = window.electronAPI.onGroupsChanged(setGroups);
    return unsub;
  }, []);

  // Load privacy mode
  useEffect(() => {
    window.electronAPI.getPrivacyMode().then(setPrivacyMode).catch(() => { /* ignore */ });
  }, []);

  // Track shelf + highlight counts for toolbar badges
  useEffect(() => {
    window.electronAPI.getShelf().then((items) => setShelfCount(items.length)).catch(() => { /* ignore */ });
    const u1 = window.electronAPI.onShelfChanged((items) => setShelfCount(items.length));
    window.electronAPI.getHighlightBuffer().then((b) => setHighlightCount(b.length)).catch(() => { /* ignore */ });
    const u2 = window.electronAPI.onHighlightBufferChanged((b) => setHighlightCount(b.length));
    return () => { u1(); u2(); };
  }, []);

  // Group sidebar: push WebContentsView right so the left panel is visible
  useEffect(() => {
    window.electronAPI.setLeftInset(groupSidebarOpen ? GROUP_SIDEBAR_WIDTH : 0).catch(() => { /* ignore */ });
  }, [groupSidebarOpen]);

  // Auto-retract group sidebar when switching back to the Links App tab
  useEffect(() => {
    if (activeTab?.type === 'links_app' && groupSidebarOpen) {
      setGroupSidebarOpen(false);
    }
  }, [activeTab?.type]);

  // Right sidebar: push WebContentsView left so the right panel is visible
  useEffect(() => {
    window.electronAPI.setRightInset(rightMode ? RIGHT_SIDEBAR_WIDTH : 0).catch(() => { /* ignore */ });
  }, [rightMode]);

  // CapturePicker modal: push WebContentsView fully out of view while modal is open
  useEffect(() => {
    window.electronAPI.setTopInset(capturePickerOpts ? 9999 : 0).catch(() => { /* ignore */ });
  }, [capturePickerOpts]);

  // Subscribe to capture picker trigger from main process (context menu / Ctrl+Shift+S)
  useEffect(() => {
    const unsub = window.electronAPI.onShowCapturePicker(setCapturePickerOpts);
    const unsubQuick = window.electronAPI.onTriggerQuickCapture(() => {
      if (activeTab?.type === 'web') {
        setCapturePickerOpts({ type: 'page', tabId: activeTab.id });
      }
    });
    return () => { unsub(); unsubQuick(); };
  }, [activeTab]);

  const handlePrivacyChange = useCallback(async (mode: PrivacyMode) => {
    setPrivacyMode(mode);
    await window.electronAPI.setPrivacyMode(mode).catch(() => { /* ignore */ });
  }, []);

  // Toggle right sidebar — single button opens to last used mode (default ai)
  const toggleSidebar = useCallback(() => {
    setRightMode((prev) => {
      if (prev !== null) return null;
      return lastRightMode.current;
    });
  }, []);

  // Track last used mode so reopening returns to the same panel
  const handleModeChange = useCallback((mode: RightMode) => {
    lastRightMode.current = mode;
    setRightMode(mode);
  }, []);

  const handleShowCapturePicker = useCallback(
    (type: 'page' | 'selection') => {
      if (activeTab?.type === 'web') {
        setCapturePickerOpts({ type, tabId: activeTab.id });
      }
    },
    [activeTab],
  );

  const isLinksApp = activeTab?.type === 'links_app';

  return (
    <>
      {/* Group sidebar (left column, fixed below chrome bar) */}
      {groupSidebarOpen && (
        <div
          style={{
            position: 'fixed',
            top: CHROME_HEIGHT,
            left: 0,
            bottom: 0,
            zIndex: 50,
            display: 'flex',
          }}
        >
          <GroupSidebar
            tabs={tabs}
            isOpen={groupSidebarOpen}
            onClose={() => setGroupSidebarOpen(false)}
            activeTabId={activeTab?.id ?? null}
          />
        </div>
      )}

      {/* Chrome bar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: CHROME_HEIGHT,
          background: 'linear-gradient(180deg, #14142a 0%, #12122a 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
          WebkitAppRegion: 'drag' as never,
          userSelect: 'none',
        }}
      >
        {/* Row 1: window controls + tab strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 36,
            padding: '0 4px',
            gap: 4,
          }}
        >
          {/* Group sidebar toggle */}
          <button
            title={groupSidebarOpen ? 'Close groups' : 'Project groups'}
            onClick={() => setGroupSidebarOpen((v) => !v)}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              background: groupSidebarOpen ? 'rgba(74,158,255,0.2)' : 'transparent',
              color: groupSidebarOpen ? '#4a9eff' : '#888',
              cursor: 'pointer',
              borderRadius: 4,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              WebkitAppRegion: 'no-drag' as never,
            }}
          >
            ☰
          </button>

          {/* Tab strip */}
          <TabStrip tabs={tabs} groups={groups} onNewTab={() => window.electronAPI.newTab()} />

          {/* Window controls — far right of row 1 */}
          <WindowControls />
        </div>

        {/* Row 2: nav + address + capture + panel toggles */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 44,
            padding: '0 8px',
            gap: 6,
          }}
        >
          <NavButtons activeTabId={activeTab?.id ?? null} nav={nav} isLinksApp={isLinksApp ?? true} />
          <AddressBar activeTab={activeTab} />
          <CaptureToolbar activeTab={activeTab} onShowCapturePicker={handleShowCapturePicker} />

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

          {/* Single sidebar toggle — badge shows unread shelf/highlight count */}
          <button
            title={rightMode ? 'Close panel' : 'Open panel'}
            onClick={toggleSidebar}
            style={{
              position: 'relative',
              width: 34,
              height: 34,
              border: 'none',
              background: rightMode ? 'rgba(74,158,255,0.18)' : 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              WebkitAppRegion: 'no-drag' as never,
              transition: 'background 0.15s',
              opacity: rightMode ? 1 : 0.75,
            }}
          >
            <img src={sidebarIcon} alt="Panel" width={22} height={22} style={{ objectFit: 'contain' }} />
            {(shelfCount + highlightCount) > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  background: '#e8a020',
                  color: '#000',
                  borderRadius: '50%',
                  width: 13,
                  height: 13,
                  fontSize: 8,
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {Math.min(shelfCount + highlightCount, 9)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Capture Picker modal — full overlay while open (WebContentsView pushed by topInset) */}
      {capturePickerOpts && (
        <CapturePicker
          opts={capturePickerOpts}
          onClose={() => setCapturePickerOpts(null)}
          onSaved={() => setCapturePickerOpts(null)}
        />
      )}

      {/* Unified right sidebar */}
      {rightMode && (
        <RightSidebar
          mode={rightMode}
          onModeChange={handleModeChange}
          onClose={() => setRightMode(null)}
          privacyMode={privacyMode}
          onPrivacyChange={handlePrivacyChange}
          groups={groups}
        />
      )}
    </>
  );
}

