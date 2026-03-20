import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HealthResponse } from '@/lib/types';
import logoIcon from '@/assets/icons/logo_links.png?url';
import './TopBar.css';

export function TopBar() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 5000,
  });

  const isConnected = health?.ok === true && health?.database?.connected === true;

  return (
    <div className="top-bar">
      <div className="top-bar__left">
        <div className="icon-badge icon-badge--compact">
          <img src={logoIcon} alt="Links" className="logo-img" />
        </div>
        <div className="top-bar__title">
          <span className="gold">LINKS</span>
          <span className="top-bar__subtitle">Research Intelligence</span>
        </div>
      </div>

      <div className="top-bar__right">
        <div className="connection-status">
          <div className={`connection-dot ${isConnected ? 'connected' : ''}`} />
          <span className="text-muted">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  );
}
