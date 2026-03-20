import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { Pot, ProcessingJob } from '@/lib/types';
import potsIcon from '@/assets/icons/pots.png?url';
import searchIcon from '@/assets/icons/search.jpg?url';
import jobsIcon from '@/assets/icons/Jobs.png?url';
import chatIcon from '@/assets/icons/chat.jpg?url';
import settingsIcon from '@/assets/icons/settings.jpg?url';
import calendarIcon from '@/assets/icons/calendar.jpg?url';
import dietIcon from '@/assets/icons/diet.jpg?url';
import rssIcon from '@/assets/icons/rss.png?url';
import agentIcon from '@/assets/icons/AI.png?url';
import { HeartbeatStatusWidget } from '@/features/automation/HeartbeatStatusWidget';
import './Dashboard.css';

export function Dashboard() {
  const navigate = useNavigate();

  const { data: potsData } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<{ jobs: ProcessingJob[]; total: number }>('/jobs?limit=10'),
  });

  const pots = potsData?.pots ?? [];
  const jobs = jobsData?.jobs ?? [];
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const runningCount = jobs.filter((j) => j.status === 'running').length;

  return (
    <div className="dashboard">
      <div className="dashboard__status">
        <div className="status-card">
          <span className="status-card__label">API</span>
          <span className="status-card__value gold">Connected</span>
        </div>
        <div className="status-card">
          <span className="status-card__label">Worker</span>
          <span className="status-card__value">Idle</span>
        </div>
        <div className="status-card">
          <span className="status-card__label">Queue</span>
          <span className="status-card__value">
            {queuedCount} queued, {runningCount} running
          </span>
        </div>
      </div>

      <div className="dashboard__grid">
        <TileCard
          icon={potsIcon}
          title="Pots"
          subtitle={`${pots.length} research pots`}
          onClick={() => navigate('/pots')}
          isImage
        />
        <TileCard
          icon={searchIcon}
          title="Search"
          subtitle="Find entries"
          onClick={() => navigate('/search')}
          isImage
        />
        <TileCard
          icon={chatIcon}
          title="Chat"
          subtitle="Ask anything"
          onClick={() => navigate('/chat')}
          isImage
        />
        <TileCard
          icon={jobsIcon}
          title="Jobs"
          subtitle={`${queuedCount + runningCount} active`}
          onClick={() => navigate('/jobs')}
          isImage
        />
        <TileCard
          icon={settingsIcon}
          title="Settings"
          subtitle="Configure system"
          onClick={() => navigate('/settings')}
          isImage
        />
        <TileCard
          icon={calendarIcon}
          title="Calendar"
          subtitle="Events & dates"
          onClick={() => navigate('/calendar')}
          isImage
        />
        <TileCard
          icon={dietIcon}
          title="Diet"
          subtitle="Meals & nutrition"
          onClick={() => navigate('/diet')}
          isImage
        />
        <TileCard
          icon={rssIcon}
          title="RSS"
          subtitle="Feeds & articles"
          onClick={() => navigate('/rss')}
          isImage
        />
        <TileCard
          icon={agentIcon}
          title="Agent"
          subtitle="Insights & tools"
          onClick={() => navigate('/agent')}
          isImage
        />
      </div>

      {pots.length > 0 && (
        <div className="dashboard__heartbeat">
          <div className="dashboard__section-header">
            <span>Research Status</span>
            <span className="dashboard__section-sub">Automation-enabled pots</span>
          </div>
          <div className="dashboard__heartbeat-grid">
            {pots.map((pot) => (
              <HeartbeatStatusWidget
                key={pot.id}
                potId={pot.id}
                potName={pot.name}
                onOpen={() => navigate(`/pots/${pot.id}?tab=automation`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TileCardProps {
  icon: string;
  title: string;
  subtitle: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
  isImage?: boolean;
}

function TileCard({ icon, title, subtitle, badge, onClick, disabled, isImage }: TileCardProps) {
  return (
    <button
      className={`tile-card ${disabled ? 'tile-card--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="tile-card__icon-wrapper">
        <div className="icon-badge">
          {isImage ? (
            <img src={icon} alt={title} className="tile-card__icon-img" />
          ) : (
            icon
          )}
        </div>
        {badge && <div className="tile-card__badge">{badge}</div>}
      </div>
      <div className="tile-card__content">
        <h3 className="tile-card__title">{title}</h3>
        <p className="tile-card__subtitle">{subtitle}</p>
      </div>
    </button>
  );
}
