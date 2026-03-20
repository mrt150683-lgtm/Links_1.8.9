import { useRef, useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import chatIcon from '@/assets/icons/AI.png?url';
import dashboardIcon from '@/assets/icons/dashboard.png?url';
import potsIcon from '@/assets/icons/pots.png?url';
import searchIcon from '@/assets/icons/search.jpg?url';
import jobsIcon from '@/assets/icons/Jobs.png?url';
import settingsIcon from '@/assets/icons/settings.jpg?url';
import journalIcon from '@/assets/icons/generate.png?url';
import scoutIcon from '@/assets/icons/entities.png?url';
import auditIcon from '@/assets/icons/Audit.png?url';
import inboxIcon from '@/assets/icons/inbox.png?url';
import './TabsRow.css';

const mainTabs = [
  { path: '/', label: 'Dashboard', icon: dashboardIcon },
  { path: '/chat', label: 'Chat', icon: chatIcon },
  { path: '/pots', label: 'Pots', icon: potsIcon },
  { path: '/search', label: 'Search', icon: searchIcon },
  { path: '/jobs', label: 'Jobs', icon: jobsIcon },
  { path: '/settings', label: 'Settings', icon: settingsIcon },
];

const toolsTabs = [
  { path: '/journal', label: 'Journal', icon: journalIcon },
  { path: '/insights', label: 'Insights', icon: inboxIcon },
  { path: '/diet', label: 'Diet', icon: journalIcon },
  { path: '/rss', label: 'RSS', icon: inboxIcon },
  { path: '/scout', label: 'Scout', icon: scoutIcon },
  { path: '/audit', label: 'Audit', icon: auditIcon },
];

const TOOLS_PATHS = toolsTabs.map((t) => t.path);

function ToolsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isActive = TOOLS_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'));

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="tab-dropdown" ref={ref}>
      <button
        className={`tab tab-dropdown__trigger ${isActive ? 'tab--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg
          className="tab__icon-img"
          viewBox="0 0 18 18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ flexShrink: 0 }}
        >
          <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
          <rect x="11" y="1" width="6" height="6" rx="1" fill="currentColor" />
          <rect x="1" y="11" width="6" height="6" rx="1" fill="currentColor" />
          <rect x="11" y="11" width="6" height="6" rx="1" fill="currentColor" />
        </svg>
        <span className="tab__label">Tools</span>
        <span className="tab-dropdown__caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="tab-dropdown__menu" role="menu">
          {toolsTabs.map((tab) => (
            <li key={tab.path} role="none">
              <NavLink
                to={tab.path}
                className={({ isActive }) => `tab ${isActive ? 'tab--active' : ''}`}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                <img src={tab.icon} alt={tab.label} className="tab__icon-img" />
                <span className="tab__label">{tab.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TabsRow() {
  return (
    <div className="tabs-row">
      <nav className="tabs-nav">
        {mainTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/'}
            className={({ isActive }) => `tab ${isActive ? 'tab--active' : ''}`}
          >
            <img src={tab.icon} alt={tab.label} className="tab__icon-img" />
            <span className="tab__label">{tab.label}</span>
          </NavLink>
        ))}
        <ToolsDropdown />
      </nav>
    </div>
  );
}
