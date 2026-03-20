import { useState, useEffect } from 'react';
import type { NavState } from '../../shared/types.js';

export function useNavigation(activeTabId: string | null) {
  const [nav, setNav] = useState<NavState | null>(null);

  useEffect(() => {
    if (!activeTabId) {
      setNav(null);
      return;
    }
    const unsub = window.electronAPI.onNavigationChanged((navState) => {
      if (navState.tabId === activeTabId) {
        setNav(navState);
      }
    });
    return unsub;
  }, [activeTabId]);

  return nav;
}
