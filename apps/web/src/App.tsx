import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { PotsPage } from './pages/Pots';
import { PotDetailPage } from './pages/PotDetail';
import { EntryDetailPage } from './pages/EntryDetail';
import { JobsPage } from './pages/Jobs';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import { SearchPage } from './pages/Search';
import { JournalPage } from './pages/Journal';
import { ScoutPage } from './pages/Scout';
import { MainChatPage } from './pages/MainChatPage';
import { CalendarPage } from './pages/CalendarPage';
import { DykPage } from './pages/DykPage';
import { DietPage } from './pages/DietPage';
import { RssPage } from './pages/RssPage';
import { AgentPage } from './pages/AgentPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="pots" element={<PotsPage />} />
            <Route path="pots/:potId" element={<PotDetailPage />} />
            <Route path="pots/:potId/entries/:entryId" element={<EntryDetailPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="chat" element={<MainChatPage />} />
            <Route path="scout" element={<ScoutPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="insights" element={<DykPage />} />
            <Route path="diet" element={<DietPage />} />
            <Route path="rss" element={<RssPage />} />
            <Route path="agent" element={<AgentPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
