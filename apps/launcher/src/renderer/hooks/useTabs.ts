import { useState, useEffect } from 'react';
import type { TabState } from '../../shared/types.js';

export function useTabs() {
  const [tabs, setTabs] = useState<TabState[]>([]);

  useEffect(() => {
    // Initial load
    window.electronAPI.getTabs().then(setTabs).catch(() => { /* ignore */ });

    // Subscribe to push updates
    const unsub = window.electronAPI.onTabsChanged(setTabs);
    return unsub;
  }, []);

  const activeTab = tabs.find((t) => t.isActive) ?? null;

  return { tabs, activeTab };
}
