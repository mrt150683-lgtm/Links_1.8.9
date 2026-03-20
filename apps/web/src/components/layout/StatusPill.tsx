import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HealthResponse } from '@/lib/types';
import './StatusPill.css';

export function StatusPill() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 5000,
  });

  const status = health?.ok === true && health?.database?.connected === true ? 'Operational' : 'Degraded';
  const isOk = health?.ok === true && health?.database?.connected === true;

  return (
    <div className="status-pill">
      <div className={`status-pill__dot ${isOk ? 'ok' : ''}`} />
      <span className="status-pill__text">System {status}</span>
    </div>
  );
}
