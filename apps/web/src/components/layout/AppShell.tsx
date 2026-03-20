import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { TabsRow } from './TabsRow';
import { StatusPill } from './StatusPill';
import './AppShell.css';

export function AppShell() {
  return (
    <div className="app-shell">
      <TopBar />
      <TabsRow />
      <main className="app-content">
        <Outlet />
      </main>
      <StatusPill />
    </div>
  );
}
