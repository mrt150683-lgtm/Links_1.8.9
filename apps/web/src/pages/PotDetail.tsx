import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Pot, Entry } from '@/lib/types';
import { AssetUpload } from '@/components/assets/AssetUpload';
import { AssetList } from '@/components/assets/AssetList';
import entriesIcon from '@/assets/icons/entries.png?url';
import textIcon from '@/assets/icons/text.png?url';
import linksIcon from '@/assets/icons/logo_links.png?url';
import imagesIcon from '@/assets/icons/image.png?url';
import docIcon from '@/assets/icons/doc.png?url';
import videoIcon from '@/assets/icons/video.png?url';
import potsIcon from '@/assets/icons/pots.png?url';
import searchIcon from '@/assets/icons/search.jpg?url';
import processedIcon from '@/assets/icons/processed.png?url';
import tagsIcon from '@/assets/icons/tags.png?url';
import entitiesIcon from '@/assets/icons/entities.png?url';
import summariesIcon from '@/assets/icons/summaries.png?url';
import connectionsIcon from '@/assets/icons/logo_links.png?url';
import { JournalViewer } from './Journal';
import { ProjectPlanningTab } from '@/components/planning/ProjectPlanning';
import { PotRoleButton } from '@/components/pots/PotRoleButton';
import { DeepResearchTab } from '@/components/deep-research/DeepResearchTab';
import { PotChatTab } from '@/components/pot-chat/PotChatTab';
import { OnboardingSetupChat } from '@/components/onboarding/OnboardingSetupChat';
import { PotSettingsTab } from './PotSettingsTab';
import type { ResearchNotification } from '@/lib/types';
import { useIntelligenceSummary, useDeliveredToday, useAgentConfig } from '@/features/agent/useAgent';
import { HeartbeatPanel } from '@/features/automation/HeartbeatPanel';
import { TasksPanel } from '@/features/automation/TasksPanel';
import { AutomationDiagnosticsPanel } from '@/features/automation/AutomationDiagnosticsPanel';
import { AutomationSettingsPanel } from '@/features/automation/AutomationSettingsPanel';
import './PotDetail.css';

type PotTab = 'overview' | 'entries' | 'assets' | 'intelligence' | 'gen-intelligence' | 'journal' | 'project-planning' | 'deep-research' | 'chat' | 'jobs' | 'settings' | 'automation';

const VALID_TABS: PotTab[] = ['overview','entries','assets','intelligence','gen-intelligence','journal','project-planning','deep-research','chat','jobs','settings','automation'];

export function PotDetailPage() {
  const { potId } = useParams<{ potId: string }>();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') as PotTab | null;
  const [activeTab, setActiveTab] = useState<PotTab>(
    initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'overview'
  );
  const [showOnboarding, setShowOnboarding] = useState(true);
  const navigate = useNavigate();

  const { data: pot, isLoading: potLoading } = useQuery({
    queryKey: ['pot', potId],
    queryFn: () => api.get<Pot>(`/pots/${potId}`),
    enabled: !!potId,
  });

  const { data: entriesData } = useQuery({
    queryKey: ['pot-entries', potId],
    queryFn: () => api.get<{ entries: Entry[]; total: number }>(`/pots/${potId}/entries`),
    enabled: !!potId,
    refetchInterval: 8000,
  });

  const { data: unreadNotificationsData } = useQuery({
    queryKey: ['research-notifications', potId],
    queryFn: () =>
      api
        .get<{ notifications: ResearchNotification[] }>(
          `/research/notifications?pot_id=${potId}&unread_only=true`
        )
        .catch(() => ({ notifications: [] })),
    enabled: !!potId && activeTab !== 'deep-research',
    refetchInterval: 30000,
  });

  const unreadCount = unreadNotificationsData?.notifications?.length ?? 0;

  const { data: onboardingData } = useQuery({
    queryKey: ['pot-onboarding', potId],
    queryFn: () =>
      api
        .get<{ pot_id: string; completed_at: number | null }>(`/pots/${potId}/onboarding`)
        .catch(() => null),
    enabled: !!potId,
  });

  const entries = entriesData?.entries ?? [];

  if (potLoading) {
    return (
      <div className="pot-detail">
        <div className="skeleton" style={{ height: '60px', marginBottom: '24px' }} />
        <div className="skeleton" style={{ height: '400px' }} />
      </div>
    );
  }

  if (!pot) {
    return (
      <div className="pot-detail">
        <div className="pot-detail__error">
          <h2>Pot not found</h2>
          <button className="btn-secondary" onClick={() => navigate('/pots')}>
            ← Back to Pots
          </button>
        </div>
      </div>
    );
  }

  const needsOnboarding =
    showOnboarding &&
    onboardingData !== undefined &&
    onboardingData !== null &&
    onboardingData.completed_at === null;

  return (
    <div className={`pot-detail${activeTab === 'chat' ? ' pot-detail--chat-mode' : ''}`}>
      {needsOnboarding && pot && (
        <div className="pot-detail__onboarding-overlay">
          <OnboardingSetupChat
            potId={pot.id}
            potName={pot.name}
            onComplete={() => setShowOnboarding(false)}
            onSkip={() => setShowOnboarding(false)}
          />
        </div>
      )}
      {activeTab === 'chat' ? (
        /* Compact nav for chat mode — replaces header + full tabs */
        <div className="pot-detail__chat-nav">
          <button className="btn-ghost" onClick={() => setActiveTab('overview')}>
            ← Back
          </button>
          <span className="pot-detail__chat-nav-title">{pot.name}</span>
          <select
            className="pot-detail__tab-select"
            value="chat"
            onChange={(e) => setActiveTab(e.target.value as PotTab)}
          >
            <option value="overview">Overview</option>
            <option value="entries">Entries</option>
            <option value="assets">Assets</option>
            <option value="intelligence">Intelligence</option>
            <option value="gen-intelligence">Generated Intel</option>
            <option value="journal">Journal</option>
            <option value="project-planning">Project Planning</option>
            <option value="deep-research">Deep Research</option>
            <option value="chat">▶ Chat</option>
          </select>
        </div>
      ) : (
        <>
          <div className="pot-detail__header">
            <button className="btn-ghost" onClick={() => navigate('/pots')}>
              ← Back
            </button>
            <div className="pot-detail__title-section">
              <img src={potsIcon} alt="Pot" className="pot-detail__icon" />
              <div>
                <h1 className="pot-detail__title">{pot.name}</h1>
                {pot.description && <p className="pot-detail__description">{pot.description}</p>}
              </div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <PotRoleButton potId={pot.id} />
            </div>
          </div>

          <div className="pot-detail__tabs">
            <button
              className={`pot-tab ${activeTab === 'overview' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`pot-tab ${activeTab === 'entries' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('entries')}
            >
              Entries
              {entries && entries.length > 0 && (
                <span className="pot-tab__badge">{entries.length}</span>
              )}
            </button>
            <button
              className={`pot-tab ${activeTab === 'assets' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('assets')}
            >
              Assets
            </button>
            <button
              className={`pot-tab ${activeTab === 'intelligence' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('intelligence')}
            >
              Intelligence
            </button>
            <button
              className={`pot-tab ${activeTab === 'gen-intelligence' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('gen-intelligence')}
            >
              Generated Intel
            </button>
            <button
              className={`pot-tab ${activeTab === 'journal' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('journal')}
            >
              Journal
            </button>
            <button
              className={`pot-tab ${activeTab === 'project-planning' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('project-planning')}
            >
              Project Planning
            </button>
            <button
              className={`pot-tab ${activeTab === 'deep-research' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('deep-research')}
            >
              Deep Research
              {unreadCount > 0 && activeTab !== 'deep-research' && (
                <span className="pot-tab__badge">{unreadCount}</span>
              )}
            </button>
            <button
              className="pot-tab"
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              className={`pot-tab ${activeTab === 'jobs' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('jobs')}
              disabled
            >
              Jobs
            </button>
            <button
              className={`pot-tab ${activeTab === 'settings' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
            <button
              className={`pot-tab ${activeTab === 'automation' ? 'pot-tab--active' : ''}`}
              onClick={() => setActiveTab('automation')}
            >
              Automation
            </button>
          </div>
        </>
      )}

      <AgentInsightBanner potId={potId!} onViewAgent={() => setActiveTab('settings')} />

      <div className="pot-detail__content">
        {activeTab === 'overview' && <OverviewTab pot={pot} entries={entries} />}
        {activeTab === 'entries' && <EntriesTab potId={potId!} entries={entries} />}
        {activeTab === 'assets' && <AssetsTab potId={potId!} />}
        {activeTab === 'intelligence' && <IntelligenceTab potId={potId!} entries={entries} />}
        {activeTab === 'gen-intelligence' && <GeneratedIntelligenceTab potId={potId!} />}
        {activeTab === 'journal' && (
          <div className="journal-tab">
            <JournalViewer scopeType="pot" potId={potId!} />
          </div>
        )}
        {activeTab === 'project-planning' && <ProjectPlanningTab potId={potId!} />}
        {activeTab === 'deep-research' && <DeepResearchTab potId={potId!} />}
        {activeTab === 'chat' && <PotChatTab potId={potId!} onNavigateHome={() => setActiveTab('overview')} />}
        {activeTab === 'settings' && <PotSettingsTab potId={potId!} />}
        {activeTab === 'automation' && <AutomationTab potId={potId!} />}
      </div>
    </div>
  );
}

// ── Automation Tab ────────────────────────────────────────────────────────

type AutomationSubTab = 'heartbeat' | 'tasks' | 'diagnostics' | 'settings';

function AutomationTab({ potId }: { potId: string }) {
  const [sub, setSub] = useState<AutomationSubTab>('heartbeat');

  const subLabels: Record<AutomationSubTab, string> = {
    heartbeat: 'Heartbeat',
    tasks: 'Tasks',
    diagnostics: 'Diagnostics',
    settings: 'Settings',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['heartbeat', 'tasks', 'diagnostics', 'settings'] as AutomationSubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              fontSize: 13,
              background: sub === s ? 'var(--gold)' : 'var(--bg-secondary)',
              color: sub === s ? '#1a1a1a' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            {subLabels[s]}
          </button>
        ))}
      </div>
      {sub === 'heartbeat' && <HeartbeatPanel potId={potId} />}
      {sub === 'tasks' && <TasksPanel potId={potId} />}
      {sub === 'diagnostics' && <AutomationDiagnosticsPanel potId={potId} />}
      {sub === 'settings' && (
        <AutomationSettingsPanel
          potId={potId}
          onViewHeartbeat={() => setSub('heartbeat')}
          onViewTasks={() => setSub('tasks')}
        />
      )}
    </div>
  );
}

// ── Agent Insight Banner ───────────────────────────────────────────────────

function AgentInsightBanner({ potId, onViewAgent }: { potId: string; onViewAgent: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const { data: agentConfig } = useAgentConfig(potId);
  const { data: deliveredToday } = useDeliveredToday(potId);

  if (dismissed || !agentConfig?.enabled || !deliveredToday?.candidates?.length) return null;

  const latest = deliveredToday.candidates[0];
  const title = latest.title.length > 60 ? latest.title.slice(0, 60) + '…' : latest.title;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 16px',
      background: 'rgba(245, 158, 11, 0.08)',
      borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
      fontSize: '13px',
    }}>
      <span>💡</span>
      <span style={{ fontWeight: 600, marginRight: '4px' }}>{latest.candidate_type}:</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>
        {title}
      </span>
      <button
        className="btn-ghost"
        style={{ fontSize: '12px', padding: '2px 8px', whiteSpace: 'nowrap' }}
        onClick={onViewAgent}
      >
        View in Agent ↗
      </button>
      <button
        className="btn-ghost"
        style={{ fontSize: '12px', padding: '2px 6px' }}
        onClick={() => setDismissed(true)}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Tab Components ─────────────────────────────────────────────────────────

interface OverviewTabProps {
  pot: Pot;
  entries: Entry[];
}

function OverviewTab({ pot, entries }: OverviewTabProps) {
  const entriesCount = entries.length;
  const textCount = entries.filter((e) => e.type === 'text' || e.type === 'doc').length;
  const linkCount = entries.filter((e) => e.type === 'link').length;
  const imageCount = entries.filter((e) => e.type === 'image').length;

  const { data: intel, isLoading: intelLoading } = useIntelligenceSummary(pot.id);

  const lastUsed = new Date(pot.last_used_at).toLocaleString();

  // Show top 15 tags
  const displayTags = intel?.top_tags?.slice(0, 15) ?? [];
  // Show top 3 per entity type
  const entitiesByType = useMemo(() => {
    const groups: Record<string, Array<{ label: string; type: string; count: number }>> = {
      person: [], org: [], place: [], concept: [],
    };
    for (const e of (intel?.top_entities ?? [])) {
      const t = e.type in groups ? e.type : 'concept';
      if ((groups[t] ?? []).length < 3) (groups[t] = groups[t] ?? []).push(e);
    }
    return groups;
  }, [intel?.top_entities]);

  const entityTypeIcons: Record<string, string> = { person: '👤', org: '🏢', place: '📍', concept: '💡' };

  const processedCount = intel?.processed_count ?? 0;
  const totalEligible = intel?.total_eligible ?? 0;
  const progressPct = totalEligible > 0 ? Math.round((processedCount / totalEligible) * 100) : 0;

  return (
    <div className="overview-tab">
      {/* Raw entry counts */}
      <div className="overview-tab__stats">
        <div className="stat-card panel">
          <img src={entriesIcon} alt="Entries" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{entriesCount}</div>
            <div className="stat-card__label">Total Entries</div>
          </div>
        </div>
        <div className="stat-card panel">
          <img src={textIcon} alt="Text" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{textCount}</div>
            <div className="stat-card__label">Text</div>
          </div>
        </div>
        <div className="stat-card panel">
          <img src={linksIcon} alt="Links" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{linkCount}</div>
            <div className="stat-card__label">Links</div>
          </div>
        </div>
        <div className="stat-card panel">
          <img src={imagesIcon} alt="Images" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{imageCount}</div>
            <div className="stat-card__label">Images</div>
          </div>
        </div>
      </div>

      {/* Intelligence Dashboard */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>

        {/* 1. Processing Status */}
        <div className="panel" style={{ padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Processing Status</h3>
          {intelLoading ? (
            <div className="skeleton" style={{ height: '20px', borderRadius: '4px' }} />
          ) : totalEligible === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>Pending — add entries to begin</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <div style={{ flex: 1, background: 'var(--color-border, #e5e7eb)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPct}%`, background: progressPct === 100 ? '#22c55e' : 'var(--color-primary, #6366f1)', height: '100%', transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{progressPct}%</span>
              </div>
              <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
                {processedCount === totalEligible
                  ? `All ${totalEligible} entries analyzed ✓`
                  : `${processedCount} of ${totalEligible} entries analyzed`}
              </p>
            </>
          )}
        </div>

        {/* 2. Tag Cloud */}
        <div className="panel" style={{ padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Tags</h3>
          {intelLoading ? (
            <div className="skeleton" style={{ height: '36px', borderRadius: '4px' }} />
          ) : displayTags.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>No tags yet</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {displayTags.map((tag) => (
                <span
                  key={tag.label}
                  className="tag-chip"
                  style={{ fontSize: '12px', padding: '3px 8px' }}
                  title={`${Math.round(tag.avg_confidence * 100)}% avg confidence`}
                >
                  {tag.label} <span style={{ opacity: 0.6, fontSize: '11px' }}>×{tag.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 3. Top Entities */}
        <div className="panel" style={{ padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Entities</h3>
          {intelLoading ? (
            <div className="skeleton" style={{ height: '60px', borderRadius: '4px' }} />
          ) : (intel?.top_entities?.length ?? 0) === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>No entities extracted yet</p>
          ) : (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {(['person', 'org', 'place', 'concept'] as const).map((type) => {
                const group = entitiesByType[type] ?? [];
                if (group.length === 0) return null;
                return (
                  <div key={type} style={{ minWidth: '120px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                      {entityTypeIcons[type]} {type.charAt(0).toUpperCase() + type.slice(1)}
                    </div>
                    {group.map((e) => (
                      <div key={e.label} style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{e.label}</span>
                        <span style={{ opacity: 0.5, fontSize: '11px' }}>×{e.count}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. Recent Connections */}
        <div className="panel" style={{ padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Recent Connections</h3>
          {intelLoading ? (
            <div className="skeleton" style={{ height: '40px', borderRadius: '4px' }} />
          ) : (intel?.recent_links?.length ?? 0) === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>No connections yet — trigger link discovery in the Intelligence tab</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {intel!.recent_links.map((link, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <span className="badge" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{link.link_type}</span>
                  <span className="text-muted" style={{ fontSize: '11px' }}>{link.src_entry_id.slice(0, 6)}… → {link.dst_entry_id.slice(0, 6)}…</span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.6 }}>{Math.round(link.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. Latest Agent Insight (conditional) */}
        {intel?.latest_candidate && (
          <div className="panel" style={{ padding: '12px 16px', background: 'rgba(245, 158, 11, 0.06)', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span>💡</span>
              <span style={{ fontWeight: 600 }}>{intel.latest_candidate.candidate_type}:</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {intel.latest_candidate.title}
              </span>
              <span style={{ opacity: 0.6, fontSize: '11px', whiteSpace: 'nowrap' }}>
                {Math.round(intel.latest_candidate.confidence * 100)}% conf
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="overview-tab__info panel" style={{ marginTop: '16px' }}>
        <h3>Pot Information</h3>
        <div className="info-row">
          <span className="info-row__label">Created</span>
          <span className="info-row__value">{new Date(pot.created_at).toLocaleString()}</span>
        </div>
        <div className="info-row">
          <span className="info-row__label">Last Used</span>
          <span className="info-row__value">{lastUsed}</span>
        </div>
        <div className="info-row">
          <span className="info-row__label">ID</span>
          <span className="info-row__value text-muted">{pot.id}</span>
        </div>
      </div>
    </div>
  );
}

interface EntriesTabProps {
  potId: string;
  entries: Entry[];
}

function EntriesTab({ potId, entries }: EntriesTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const navigate = useNavigate();
  const { data: intel } = useIntelligenceSummary(potId);

  const filteredEntries = entries.filter((entry) => {
    // Type filter (text includes both 'text' and 'doc' types)
    if (filterType !== 'all') {
      if (filterType === 'text' && entry.type !== 'text' && entry.type !== 'doc') return false;
      if (filterType !== 'text' && entry.type !== filterType) return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        entry.content_text?.toLowerCase().includes(query) ||
        entry.source_title?.toLowerCase().includes(query) ||
        entry.source_url?.toLowerCase().includes(query) ||
        entry.link_title?.toLowerCase().includes(query) ||
        entry.notes?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  return (
    <div className="entries-tab">
      <div className="entries-tab__controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <img src={searchIcon} alt="Search" style={{ width: 18, height: 18, opacity: 0.6 }} />
          <input
            type="text"
            className="entries-tab__search"
            placeholder="Search entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>

        <div className="filter-chips">
          <button
            className={`filter-chip ${filterType === 'all' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All
          </button>
          <button
            className={`filter-chip ${filterType === 'text' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilterType('text')}
          >
            Text
          </button>
          <button
            className={`filter-chip ${filterType === 'link' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilterType('link')}
          >
            Links
          </button>
          <button
            className={`filter-chip ${filterType === 'image' ? 'filter-chip--active' : ''}`}
            onClick={() => setFilterType('image')}
          >
            Images
          </button>
        </div>
      </div>

      {filteredEntries.length > 0 ? (
        <div className="entries-list">
          {filteredEntries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              processingStatus={intel?.entries_status?.[entry.id]}
              onClick={() => navigate(`/pots/${potId}/entries/${entry.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="entries-tab__empty">
          <div className="icon-badge">📥</div>
          <h3>No entries yet</h3>
          <p className="text-muted">
            {searchQuery || filterType !== 'all'
              ? 'No entries match your filters'
              : 'Start capturing content to this pot'}
          </p>
        </div>
      )}
    </div>
  );
}

interface EntryCardProps {
  entry: Entry;
  onClick: () => void;
  processingStatus?: { tags: boolean; entities: boolean; summary: boolean };
}

function EntryCard({ entry, onClick, processingStatus }: EntryCardProps) {
  // Check if this is a transcript entry
  const isTranscript = entry.source_context && (entry.source_context as any).transcript;
  const parserSource = isTranscript ? (entry.source_context as any).parser_source : null;

  const typeIcons: Record<string, string> = {
    text: textIcon,
    link: linksIcon,
    image: imagesIcon,
    doc: docIcon,
  };

  // Use video icon for transcripts
  const icon = isTranscript ? videoIcon : (typeIcons[entry.type] || textIcon);

  // Show better type label for transcripts
  const typeLabel = isTranscript
    ? (parserSource === 'html' ? 'YOUTUBE TRANSCRIPT' : 'VIDEO TRANSCRIPT')
    : entry.type.toUpperCase();

  const preview = entry.content_text
    ? entry.content_text.slice(0, 200) + (entry.content_text.length > 200 ? '...' : '')
    : entry.link_title || entry.source_title || 'No preview available';

  const capturedDate = new Date(entry.captured_at).toLocaleString();

  // Processing status dot
  const processingDot = processingStatus == null
    ? null
    : processingStatus.tags && processingStatus.entities && processingStatus.summary
      ? { dot: '🟢', title: 'Fully analyzed' }
      : (processingStatus.tags || processingStatus.entities || processingStatus.summary)
        ? { dot: '🟡', title: 'Partially analyzed' }
        : { dot: '⚪', title: 'Not yet processed' };

  return (
    <div className="entry-card panel" onClick={onClick}>
      <div className="entry-card__header">
        <img src={icon} alt={typeLabel} className="entry-card__icon" />
        <div className="entry-card__title-section">
          <div className="entry-card__badges">
            <span className="badge badge--gold">{typeLabel}</span>
            {entry.capture_method && (
              <span className="badge">{entry.capture_method}</span>
            )}
          </div>
          {entry.source_title && (
            <h4 className="entry-card__title">{entry.source_title}</h4>
          )}
        </div>
        {processingDot && (
          <span title={processingDot.title} style={{ fontSize: '14px', flexShrink: 0 }}>
            {processingDot.dot}
          </span>
        )}
      </div>

      <p className="entry-card__preview">{preview}</p>

      {entry.source_url && (
        <div className="entry-card__url">
          <span className="text-muted">🔗 {entry.source_url}</span>
        </div>
      )}

      <div className="entry-card__footer">
        <span className="entry-card__meta text-muted">Captured {capturedDate}</span>
      </div>
    </div>
  );
}

interface AssetsTabProps {
  potId: string;
}

function AssetsTab({ potId }: AssetsTabProps) {
  const [videoUrl, setVideoUrl] = useState('');
  const [videoNotes, setVideoNotes] = useState('');
  const [transcriptionStatus, setTranscriptionStatus] = useState<{
    status: 'idle' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const queryClient = useQueryClient();

  const submitVideo = useMutation({
    mutationFn: async (data: { video_url: string; notes?: string }) => {
      return api.post<{ entry_id: string; job_id: string; status: string }>(
        `/pots/${potId}/videos`,
        data
      );
    },
    onSuccess: (result) => {
      setTranscriptionStatus({
        status: 'success',
        message: `Video submitted for transcription! Entry ID: ${result.entry_id.substring(0, 8)}...`,
      });
      setVideoUrl('');
      setVideoNotes('');
      queryClient.invalidateQueries({ queryKey: ['pot-entries', potId] });

      // Clear success message after 5 seconds
      setTimeout(() => {
        setTranscriptionStatus({ status: 'idle', message: '' });
      }, 5000);
    },
    onError: (error: any) => {
      setTranscriptionStatus({
        status: 'error',
        message: error.message || 'Failed to submit video for transcription',
      });

      // Clear error message after 7 seconds
      setTimeout(() => {
        setTranscriptionStatus({ status: 'idle', message: '' });
      }, 7000);
    },
  });

  const handleVideoSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!videoUrl.trim()) {
      setTranscriptionStatus({
        status: 'error',
        message: 'Please enter a video URL',
      });
      return;
    }

    // Basic URL validation
    try {
      new URL(videoUrl);
    } catch {
      setTranscriptionStatus({
        status: 'error',
        message: 'Invalid URL format',
      });
      return;
    }

    submitVideo.mutate({
      video_url: videoUrl,
      notes: videoNotes || undefined,
    });
  };

  return (
    <div className="assets-tab">
      <div className="assets-tab__upload">
        <h3>Upload Assets</h3>
        <AssetUpload potId={potId} />
      </div>

      <div className="assets-tab__upload">
        <h3>Transcribe Video</h3>
        <p className="text-muted" style={{ marginBottom: '16px' }}>
          Submit a YouTube or Rumble URL to generate a transcript with timestamps and citations.
        </p>

        <form onSubmit={handleVideoSubmit}>
          <div className="form-field">
            <label>Video URL</label>
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={submitVideo.isPending}
            />
          </div>

          <div className="form-field">
            <label>Notes (optional)</label>
            <input
              type="text"
              placeholder="Add context or notes about this video..."
              value={videoNotes}
              onChange={(e) => setVideoNotes(e.target.value)}
              disabled={submitVideo.isPending}
            />
          </div>

          {transcriptionStatus.status !== 'idle' && (
            <div
              className={`settings-message ${
                transcriptionStatus.status === 'success'
                  ? 'settings-message--success'
                  : 'settings-message--error'
              }`}
              style={{ marginBottom: '12px' }}
            >
              {transcriptionStatus.message}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={submitVideo.isPending || !videoUrl.trim()}
          >
            {submitVideo.isPending ? 'Submitting...' : 'Transcribe Video'}
          </button>
        </form>
      </div>

      <div className="assets-tab__list">
        <h3>Assets in this Pot</h3>
        <AssetList potId={potId} />
      </div>
    </div>
  );
}

interface IntelligenceTabProps {
  potId: string;
  entries: Entry[];
}

function IntelligenceTab({ potId, entries }: IntelligenceTabProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [discoveringLinks, setDiscoveringLinks] = useState<Set<string>>(new Set());
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState<{ type: 'tag' | 'entity'; value: string } | null>(null);
  const queryClient = useQueryClient();

  // Get entries suitable for intelligence display:
  // - Exclude 'link' type entries (asset pointers with no useful intelligence)
  // - Exclude untitled entries with no source_title (stubs not yet processed or meaningless)
  // - Images and audio entries are included even without content_text (they store content as blobs)
  const entriesWithArtifacts = entries.filter((e) =>
    e.type !== 'link' &&
    (e.type === 'image' || e.type === 'audio' || (e.content_text && e.content_text.trim().length > 0)) &&
    e.source_title && e.source_title.trim().length > 0
  );

  // Fetch artifact summaries for the pot — also build tag/entity→entries mapping for filtering
  const { data: potArtifactsStats } = useQuery({
    queryKey: ['pot-intelligence-stats', potId],
    queryFn: async () => {
      // Fetch artifacts for each entry
      const artifactsPromises = entriesWithArtifacts.map((entry) =>
        api.get<{ entry_id: string; artifacts: any[] }>(`/entries/${entry.id}/artifacts`).catch(() => ({ entry_id: entry.id, artifacts: [] }))
      );
      const results = await Promise.all(artifactsPromises);

      // Aggregate stats + build filter maps
      let totalTags = 0;
      let totalEntities = 0;
      let totalSummaries = 0;
      let processedEntries = 0;
      const tagToEntries: Record<string, string[]> = {};
      const entityToEntries: Record<string, string[]> = {};
      const tagCounts: Record<string, number> = {};
      const entityData: Record<string, { type: string; count: number }> = {};

      results.forEach((result, idx) => {
        const entry = entriesWithArtifacts[idx];
        const isImageOrAudio = entry.type === 'image' || entry.type === 'audio';
        const hasTags = result.artifacts.some((a: any) => a.artifact_type === 'tags');
        const hasSummary = result.artifacts.some((a: any) => a.artifact_type === 'summary');
        // Images/audio are "processed" when they have tags; text entries need a summary
        if (isImageOrAudio ? hasTags : hasSummary) processedEntries++;
        result.artifacts.forEach((artifact) => {
          if (artifact.artifact_type === 'tags' && artifact.payload.tags) {
            totalTags += artifact.payload.tags.length;
            for (const tag of artifact.payload.tags) {
              const key = (tag.label ?? '').toLowerCase();
              if (!key) continue;
              if (!tagToEntries[key]) tagToEntries[key] = [];
              if (!tagToEntries[key].includes(entry.id)) tagToEntries[key].push(entry.id);
              tagCounts[key] = (tagCounts[key] ?? 0) + 1;
            }
          } else if (artifact.artifact_type === 'entities' && artifact.payload.entities) {
            totalEntities += artifact.payload.entities.length;
            for (const entity of artifact.payload.entities) {
              const key = entity.label ?? '';
              if (!key) continue;
              if (!entityToEntries[key]) entityToEntries[key] = [];
              if (!entityToEntries[key].includes(entry.id)) entityToEntries[key].push(entry.id);
              if (!entityData[key]) {
                const rawType = (entity.type ?? 'concept').toLowerCase();
                const normalizedType = rawType === 'person' ? 'person'
                  : rawType === 'org' || rawType === 'organization' ? 'org'
                  : rawType === 'place' || rawType === 'location' ? 'place'
                  : 'concept';
                entityData[key] = { type: normalizedType, count: 0 };
              }
              entityData[key].count++;
            }
          } else if (artifact.artifact_type === 'summary') {
            totalSummaries++;
          }
        });
      });

      const allTags = Object.entries(tagCounts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      const allEntities = Object.entries(entityData)
        .map(([label, v]) => ({ label, type: v.type, count: v.count }))
        .sort((a, b) => b.count - a.count);

      return {
        totalTags,
        totalEntities,
        totalSummaries,
        processedEntries,
        totalEntries: entriesWithArtifacts.length,
        tagToEntries,
        entityToEntries,
        allTags,
        allEntities,
      };
    },
    enabled: entriesWithArtifacts.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5000;
      // Stop polling once all entries are processed
      return data.processedEntries < data.totalEntries ? 5000 : false;
    },
  });

  // Fetch links for this pot
  const { data: linksData } = useQuery({
    queryKey: ['pot-links', potId],
    queryFn: () => api.get<{ pot_id: string; links: any[]; total_count: number }>(`/pots/${potId}/links`).catch(() => ({ pot_id: potId, links: [], total_count: 0 })),
    refetchInterval: 10000,
  });

  const stats = potArtifactsStats || {
    totalTags: 0,
    totalEntities: 0,
    totalSummaries: 0,
    processedEntries: 0,
    totalEntries: entriesWithArtifacts.length,
  };

  const pendingEntries = stats.totalEntries - stats.processedEntries;
  const processingProgress = stats.totalEntries > 0
    ? Math.round((stats.processedEntries / stats.totalEntries) * 100)
    : 0;

  // Function to trigger link discovery for a single entry
  const discoverLinksForEntry = async (entryId: string) => {
    setDiscoveringLinks((prev) => new Set(prev).add(entryId));
    try {
      await api.post(`/entries/${entryId}/link-discovery`, { max_candidates: 30 });
      // Wait a bit for jobs to complete, then refresh
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['pot-links', potId] });
      }, 2000);
    } catch (error) {
      console.error('Failed to discover links:', error);
      alert('Failed to trigger link discovery. Check console for details.');
    } finally {
      setDiscoveringLinks((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  };

  // Function to trigger link discovery for all processed entries
  const discoverLinksForAll = async () => {
    // Use all entries with text content (worker will filter text entries)
    const processedEntries = entriesWithArtifacts;

    if (processedEntries.length === 0) {
      alert('No entries to discover links for. Add some text entries first.');
      return;
    }

    if (stats.processedEntries === 0) {
      alert('No processed entries yet. Wait for AI processing to complete first.');
      return;
    }

    setDiscoveringLinks(new Set(processedEntries.map((e) => e.id)));

    try {
      // Trigger link discovery for all entries in parallel
      await Promise.all(
        processedEntries.map((entry) =>
          api.post(`/entries/${entry.id}/link-discovery`, { max_candidates: 30 })
        )
      );

      // Wait for jobs to complete, then refresh
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['pot-links', potId] });
      }, 3000);
    } catch (error) {
      console.error('Failed to discover links:', error);
      alert('Failed to trigger link discovery for some entries. Check console for details.');
    } finally {
      setDiscoveringLinks(new Set());
    }
  };

  // Compute filtered entries for the filter feature
  const filteredDisplayEntries = useMemo(() => {
    if (!activeFilter || !potArtifactsStats) return entriesWithArtifacts;
    const map = activeFilter.type === 'tag'
      ? potArtifactsStats.tagToEntries
      : potArtifactsStats.entityToEntries;
    const entryIds = new Set(map[activeFilter.value] ?? []);
    return entriesWithArtifacts.filter((e) => entryIds.has(e.id));
  }, [activeFilter, potArtifactsStats, entriesWithArtifacts]);

  if (entriesWithArtifacts.length === 0) {
    return (
      <div className="intelligence-tab">
        <div className="intelligence-tab__empty">
          <div className="icon-badge">🧠</div>
          <h3>No Content to Analyze</h3>
          <p className="text-muted">
            Add text entries, upload documents, or transcribe videos to enable AI processing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="intelligence-tab">
      <div className="intelligence-tab__header">
        <h2>AI Intelligence</h2>
        <p className="text-muted">
          Automatically extracted insights from {entriesWithArtifacts.length} entries in this pot.
        </p>
      </div>

      {/* Aggregate Summary Card */}
      {potArtifactsStats && (potArtifactsStats.allTags.length > 0 || potArtifactsStats.allEntities.length > 0) && (
        <div className="panel" style={{ marginBottom: '16px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer' }}
            onClick={() => setSummaryExpanded((v) => !v)}
          >
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Summary</h3>
            <span style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{summaryExpanded ? '▼' : '▶'}</span>
          </div>
          {summaryExpanded && (
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {potArtifactsStats.allTags.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags — click to filter</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {potArtifactsStats.allTags.map((tag) => (
                      <button
                        key={tag.label}
                        onClick={() => setActiveFilter(
                          activeFilter?.type === 'tag' && activeFilter.value === tag.label ? null : { type: 'tag', value: tag.label }
                        )}
                        className="tag-chip"
                        style={{
                          fontSize: '12px',
                          padding: '3px 8px',
                          cursor: 'pointer',
                          background: activeFilter?.type === 'tag' && activeFilter.value === tag.label
                            ? 'var(--color-primary, #6366f1)'
                            : undefined,
                          color: activeFilter?.type === 'tag' && activeFilter.value === tag.label
                            ? '#fff'
                            : undefined,
                          border: 'none',
                        }}
                      >
                        {tag.label} <span style={{ opacity: 0.6, fontSize: '11px' }}>×{tag.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {potArtifactsStats.allEntities.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entities — click to filter</div>
                  {(['person', 'org', 'place', 'concept'] as const).map((type) => {
                    const typeEntities = potArtifactsStats.allEntities.filter((e) => e.type === type);
                    if (typeEntities.length === 0) return null;
                    const icons: Record<string, string> = { person: '👤', org: '🏢', place: '📍', concept: '💡' };
                    return (
                      <div key={type} style={{ marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{icons[type]} {type.charAt(0).toUpperCase() + type.slice(1)}</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                          {typeEntities.map((e) => (
                            <button
                              key={e.label}
                              onClick={() => setActiveFilter(
                                activeFilter?.type === 'entity' && activeFilter.value === e.label ? null : { type: 'entity', value: e.label }
                              )}
                              className="badge"
                              style={{
                                cursor: 'pointer',
                                fontSize: '12px',
                                background: activeFilter?.type === 'entity' && activeFilter.value === e.label
                                  ? 'var(--color-primary, #6366f1)'
                                  : undefined,
                                color: activeFilter?.type === 'entity' && activeFilter.value === e.label
                                  ? '#fff'
                                  : undefined,
                                border: 'none',
                              }}
                            >
                              {e.label} <span style={{ opacity: 0.6, fontSize: '11px' }}>×{e.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active filter strip */}
      {activeFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px', fontSize: '13px' }}>
          <span>
            Showing {filteredDisplayEntries.length} {filteredDisplayEntries.length === 1 ? 'entry' : 'entries'} {activeFilter.type === 'tag' ? 'tagged' : 'with entity'} <strong>"{activeFilter.value}"</strong>
          </span>
          <button
            className="btn-ghost"
            style={{ marginLeft: 'auto', fontSize: '12px', padding: '2px 8px' }}
            onClick={() => setActiveFilter(null)}
          >
            ✕ clear
          </button>
        </div>
      )}

      <div className="intelligence-tab__stats">
        <div className="stat-card panel">
          <img src={processedIcon} alt="Processed" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{processingProgress}%</div>
            <div className="stat-card__label">Processed</div>
            {pendingEntries > 0 && (
              <div className="text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                {pendingEntries} pending
              </div>
            )}
          </div>
        </div>

        <div className="stat-card panel">
          <img src={tagsIcon} alt="Tags" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{stats.totalTags}</div>
            <div className="stat-card__label">Tags Extracted</div>
          </div>
        </div>

        <div className="stat-card panel">
          <img src={entitiesIcon} alt="Entities" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{stats.totalEntities}</div>
            <div className="stat-card__label">Entities Found</div>
          </div>
        </div>

        <div className="stat-card panel">
          <img src={summariesIcon} alt="Summaries" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{stats.totalSummaries}</div>
            <div className="stat-card__label">Summaries</div>
          </div>
        </div>

        <div className="stat-card panel">
          <img src={connectionsIcon} alt="Connections" className="stat-card__icon" />
          <div className="stat-card__content">
            <div className="stat-card__value">{linksData?.total_count || 0}</div>
            <div className="stat-card__label">Connections</div>
          </div>
        </div>
      </div>

      {/* Discover Links Action */}
      {stats.processedEntries > 0 && (
        <div style={{ margin: '24px 0', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            className="btn-primary"
            onClick={discoverLinksForAll}
            disabled={discoveringLinks.size > 0}
          >
            {discoveringLinks.size > 0 ? '🔄 Discovering Links...' : '🔗 Discover Links for All Entries'}
          </button>
          <span className="text-muted" style={{ fontSize: '13px' }}>
            Find connections between {stats.processedEntries} processed entries
          </span>
        </div>
      )}

      {pendingEntries > 0 && (
        <div className="settings-message settings-message--info" style={{ margin: '24px 0' }}>
          <strong>Processing in Progress</strong>
          <br />
          {pendingEntries} entries are waiting to be processed. The worker will analyze them during idle time.
          <br />
          <small>Go to Settings → Idle Processing to configure or force processing now.</small>
        </div>
      )}

      <div className="intelligence-tab__entries">
        <h3>Processed Entries{activeFilter ? ` (${filteredDisplayEntries.length} matching)` : ''}</h3>
        {filteredDisplayEntries.map((entry) => (
          <EntryIntelligenceCard
            key={entry.id}
            entry={entry}
            isExpanded={selectedEntryId === entry.id}
            onToggle={() => setSelectedEntryId(selectedEntryId === entry.id ? null : entry.id)}
            onDiscoverLinks={() => discoverLinksForEntry(entry.id)}
            isDiscovering={discoveringLinks.has(entry.id)}
          />
        ))}
        {activeFilter && filteredDisplayEntries.length === 0 && (
          <p className="text-muted" style={{ fontSize: '13px', textAlign: 'center', marginTop: '16px' }}>
            No entries match this filter yet. Entries are still being processed.
          </p>
        )}
      </div>
    </div>
  );
}

interface EntryIntelligenceCardProps {
  entry: Entry;
  isExpanded: boolean;
  onToggle: () => void;
  onDiscoverLinks: () => void;
  isDiscovering: boolean;
}

function EntryIntelligenceCard({ entry, isExpanded, onToggle, onDiscoverLinks, isDiscovering }: EntryIntelligenceCardProps) {
  const { data: artifactsData } = useQuery({
    queryKey: ['entry-artifacts', entry.id],
    queryFn: () => api.get<{ entry_id: string; artifacts: any[] }>(`/entries/${entry.id}/artifacts`),
    // Always fetch so badge shows correct status even when collapsed
    refetchInterval: (query) => {
      const data = query.state.data;
      const arts = data?.artifacts ?? [];
      // Text/doc entries are fully processed once they have a summary
      // Image/audio entries are fully processed once they have tags (no summary job)
      const isImageOrAudio = entry.type === 'image' || entry.type === 'audio';
      if (isImageOrAudio) {
        if (arts.some((a: any) => a.artifact_type === 'tags')) return false;
      } else {
        if (arts.some((a: any) => a.artifact_type === 'summary')) return false;
      }
      return 5000;
    },
  });

  const artifacts = artifactsData?.artifacts || [];
  const tags = artifacts.find((a) => a.artifact_type === 'tags');
  const entities = artifacts.find((a) => a.artifact_type === 'entities');
  const summary = artifacts.find((a) => a.artifact_type === 'summary');

  const hasArtifacts = artifacts.length > 0;

  return (
    <div className="entry-intelligence-card panel">
      <div className="entry-intelligence-card__header">
        <div onClick={onToggle} style={{ flex: 1, cursor: 'pointer' }}>
          <h4 className="entry-intelligence-card__title">
            {entry.source_title || 'Untitled Entry'}
          </h4>
          <div className="entry-intelligence-card__badges">
            {hasArtifacts ? (
              <>
                {tags && <span className="badge"><img src={tagsIcon} alt="Tags" style={{ width: '12px', height: '12px', objectFit: 'contain' }} /> {tags.payload.tags.length} tags</span>}
                {entities && <span className="badge"><img src={entitiesIcon} alt="Entities" style={{ width: '12px', height: '12px', objectFit: 'contain' }} /> {entities.payload.entities.length} entities</span>}
                {summary && <span className="badge"><img src={summariesIcon} alt="Summaries" style={{ width: '12px', height: '12px', objectFit: 'contain' }} /> summarized</span>}
              </>
            ) : (
              <span className="badge">⏳ pending</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {hasArtifacts && (
            <button
              className="btn-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onDiscoverLinks();
              }}
              disabled={isDiscovering}
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              {isDiscovering ? '🔄' : '🔗 Find Links'}
            </button>
          )}
          <button className="btn-ghost" onClick={onToggle}>{isExpanded ? '▼' : '▶'}</button>
        </div>
      </div>

      {isExpanded && hasArtifacts && (
        <div className="entry-intelligence-card__content">
          {tags && tags.payload.tags.length > 0 && (
            <div className="intelligence-section">
              <h5>Tags</h5>
              <div className="tag-list">
                {tags.payload.tags.map((tag: any, idx: number) => (
                  <span key={idx} className="tag-chip">
                    {tag.label}
                    <span className="tag-confidence">{Math.round(tag.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {entities && entities.payload.entities.length > 0 && (
            <div className="intelligence-section">
              <h5>Entities</h5>
              <div className="entity-list">
                {entities.payload.entities.map((entity: any, idx: number) => (
                  <div key={idx} className="entity-item">
                    <span className="entity-type">{entity.type}</span>
                    <span className="entity-name">{entity.label}</span>
                    <span className="entity-confidence">{Math.round(entity.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary && (
            <div className="intelligence-section">
              <h5>Summary</h5>
              <p className="summary-text">{summary.payload.summary}</p>
              {summary.payload.bullets && summary.payload.bullets.length > 0 && (
                <ul className="summary-bullets">
                  {summary.payload.bullets.map((bullet: string, idx: number) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Generated Intelligence Tab
// ============================================================================

interface IntelRun {
  id: string;
  pot_id: string;
  mode: 'full' | 'digest';
  model_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  estimated_input_tokens: number;
  created_at: number;
  finished_at: number | null;
  error_message: string | null;
  custom_prompt: string | null;
  max_questions: number;
}

interface IntelQuestion {
  id: string;
  run_id: string;
  question_text: string;
  entry_ids: string[];
  category: string | null;
  rationale: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  created_at: number;
}

interface IntelAnswerEvidence {
  entry_id: string;
  excerpt: string;
  start_offset?: number;
  end_offset?: number;
}

interface IntelAnswer {
  id: string;
  question_id: string;
  answer_text: string;
  confidence: number;
  evidence: IntelAnswerEvidence[];
  excerpt_validation: 'pass' | 'fail';
  limits_text: string | null;
  model_id: string;
  created_at: number;
}

const CUSTOM_PROMPT_MAX = 5000;

function GeneratedIntelligenceTab({ potId }: { potId: string }) {
  const queryClient = useQueryClient();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [improving, setImproving] = useState(false);
  const [maxQuestions, setMaxQuestions] = useState(2);

  // Fetch runs
  const { data: runsData, refetch: refetchRuns } = useQuery({
    queryKey: ['intel-runs', potId],
    queryFn: () => api.get<{ runs: IntelRun[] }>(`/pots/${potId}/intelligence/runs`),
    enabled: !!potId,
    refetchInterval: (query) => {
      const runs = (query.state.data as { runs: IntelRun[] } | undefined)?.runs ?? [];
      const hasActive = runs.some((r) => r.status === 'queued' || r.status === 'running');
      return hasActive ? 3000 : 10000;
    },
  });

  const latestRun = runsData?.runs?.[0] ?? null;

  // Fetch questions for the latest run.
  // Include latestRun?.status in the queryKey so that when the run transitions
  // from 'running' → 'done', React Query treats it as a new query and re-fetches
  // (avoids the "0 questions forever" bug when questions are written after first fetch).
  const { data: questionsData, refetch: refetchQuestions } = useQuery({
    queryKey: ['intel-questions', potId, latestRun?.id, latestRun?.status],
    queryFn: () =>
      api.get<{ questions: IntelQuestion[] }>(
        `/pots/${potId}/intelligence/questions${latestRun ? `?run_id=${latestRun.id}` : ''}`
      ),
    enabled: !!potId && !!latestRun && latestRun.pot_id === potId,
    refetchInterval: (query) => {
      const questions = (query.state.data as { questions: IntelQuestion[] } | undefined)?.questions ?? [];
      const hasActiveQuestions = questions.some((q) => q.status === 'queued' || q.status === 'running');
      const runIsActive = latestRun?.status === 'queued' || latestRun?.status === 'running';
      // Poll while the run is active (questions not yet written) or while questions are processing
      return hasActiveQuestions || runIsActive ? 3000 : false;
    },
  });

  const questions = questionsData?.questions ?? [];

  // Fetch answer for selected question
  const { data: answerData } = useQuery({
    queryKey: ['intel-answer', selectedQuestionId],
    queryFn: () =>
      api.get<{ question: IntelQuestion; answer: IntelAnswer | null }>(
        `/pots/${potId}/intelligence/questions/${selectedQuestionId}`
      ),
    enabled: !!selectedQuestionId,
    refetchInterval: (query) => {
      const answer = (query.state.data as { answer: IntelAnswer | null } | undefined)?.answer;
      return answer ? false : 4000;
    },
  });

  const selectedQuestion = questions.find((q) => q.id === selectedQuestionId) ?? null;
  const selectedAnswer = answerData?.answer ?? null;

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const body: Record<string, unknown> = { mode: 'auto', max_questions: maxQuestions };
      const trimmed = customPrompt.trim();
      if (trimmed) body.custom_prompt = trimmed;
      await api.post(`/pots/${potId}/intelligence/generate`, body);
      await refetchRuns();
      await refetchQuestions();
    } catch (err: any) {
      setGenerateError(err?.message ?? 'Failed to trigger intelligence generation.');
    } finally {
      setGenerating(false);
    }
  };

  const handleImprove = async () => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    setImproving(true);
    setGenerateError(null);
    try {
      const result = await api.post<{ improved: string }>('/intelligence/improve-prompt', { draft: trimmed });
      setCustomPrompt(result.improved.slice(0, CUSTOM_PROMPT_MAX));
    } catch (err: any) {
      setGenerateError(err?.message ?? 'AI improvement failed.');
    } finally {
      setImproving(false);
    }
  };

  const handlePromote = async (answerId: string) => {
    setPromotingId(answerId);
    setPromoteSuccess(null);
    try {
      await api.post(`/pots/${potId}/intelligence/answers/${answerId}/promote`, {});
      setPromoteSuccess(answerId);
      queryClient.invalidateQueries({ queryKey: ['entry-artifacts'] });
    } catch (err: any) {
      setGenerateError(err?.message ?? 'Promotion failed.');
    } finally {
      setPromotingId(null);
    }
  };

  const runStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      queued: '⏳ Queued',
      running: '🔄 Running',
      done: '✅ Done',
      failed: '❌ Failed',
    };
    return map[status] ?? status;
  };

  const questionStatusIcon = (status: string) => {
    const map: Record<string, string> = { queued: '⏳', running: '🔄', done: '✅', failed: '❌' };
    return map[status] ?? '?';
  };

  const confidenceColor = (conf: number) => {
    if (conf >= 0.7) return '#22c55e';
    if (conf >= 0.4) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="gen-intelligence-tab" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header + trigger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Generated Intelligence</h2>
          <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
            AI-generated questions, research leads, and connections across your entries.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="btn-secondary"
            onClick={() => setShowCustomize((v) => !v)}
            title="Customize research focus"
            style={{ fontSize: '13px', padding: '6px 12px' }}
          >
            {customPrompt.trim() ? '✏️ Focus set' : '⚙️ Customize Focus'}
          </button>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={generating || latestRun?.status === 'queued' || latestRun?.status === 'running'}
          >
            {generating || latestRun?.status === 'running'
              ? '🔄 Generating...'
              : latestRun?.status === 'queued'
                ? '⏳ Queued...'
                : '🔮 Generate Intelligence'}
          </button>
        </div>
      </div>

      {/* Custom focus panel */}
      {showCustomize && (
        <div className="panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Question count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Questions to generate
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxQuestions}
              onChange={(e) => {
                const v = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1));
                setMaxQuestions(v);
              }}
              style={{
                width: '64px',
                padding: '4px 8px',
                fontSize: '13px',
                border: '1px solid var(--color-border, #e5e7eb)',
                borderRadius: '6px',
                background: 'var(--color-surface, #fff)',
                color: 'var(--color-text, #111)',
                textAlign: 'center',
              }}
            />
            <span className="text-muted" style={{ fontSize: '12px' }}>min 1 · max 20</span>
          </div>

          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Research Focus <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <p className="text-muted" style={{ margin: '0 0 8px', fontSize: '12px' }}>
              Describe the perspective or focus area for the AI analyst. For example: "approach this as a software security engineer focused on vulnerabilities and attack surfaces" or "focus on biological and medical implications, especially drug interactions and clinical relevance".
            </p>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value.slice(0, CUSTOM_PROMPT_MAX))}
              placeholder="e.g. Analyse from the perspective of a cybersecurity researcher, focusing on threat vectors, attack surfaces, and security implications..."
              rows={5}
              style={{
                width: '100%',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: '13px',
                padding: '8px',
                boxSizing: 'border-box',
                border: '1px solid var(--color-border, #e5e7eb)',
                borderRadius: '6px',
                background: 'var(--color-surface, #fff)',
                color: 'var(--color-text, #111)',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '11px', color: customPrompt.length > CUSTOM_PROMPT_MAX * 0.9 ? '#f59e0b' : 'var(--color-muted)' }}>
                {customPrompt.length} / {CUSTOM_PROMPT_MAX} characters
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {customPrompt.trim() && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                    onClick={() => setCustomPrompt('')}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="btn-secondary"
                  style={{ fontSize: '12px', padding: '4px 10px' }}
                  onClick={handleImprove}
                  disabled={improving || !customPrompt.trim()}
                  title="Use AI to improve your research focus description"
                >
                  {improving ? '⏳ Improving...' : '✨ Improve with AI'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {generateError && (
        <div className="settings-message settings-message--error">
          {generateError}
        </div>
      )}

      {/* Latest run info */}
      {latestRun && (
        <div className="panel" style={{ padding: '12px 16px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <span><strong>Last run:</strong> {runStatusBadge(latestRun.status)}</span>
            <span><strong>Mode:</strong> {latestRun.mode}</span>
            <span><strong>Est. tokens:</strong> {latestRun.estimated_input_tokens.toLocaleString()}</span>
            <span><strong>Requested:</strong> {latestRun.max_questions} questions</span>
            <span><strong>Generated:</strong> {questions.length}</span>
            {latestRun.error_message && (
              <span style={{ color: '#ef4444' }}>{latestRun.error_message}</span>
            )}
          </div>
          {latestRun.custom_prompt && (
            <div style={{ borderTop: '1px solid var(--color-border, #e5e7eb)', paddingTop: '8px' }}>
              <span style={{ color: 'var(--color-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Research focus</span>
              <p style={{ margin: '2px 0 0', fontSize: '12px', fontStyle: 'italic' }}>
                {latestRun.custom_prompt}
              </p>
            </div>
          )}
        </div>
      )}

      {questions.length === 0 && latestRun && latestRun.status === 'done' && (
        <div className="settings-message settings-message--info">
          No new questions or leads were generated. All questions may already be known for this snapshot, or the entries may not contain enough content for the AI to surface anything new. Try adding more entries or running again after adding new content.
        </div>
      )}

      {/* Two-column layout: question list + answer panel */}
      {questions.length > 0 && (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
          {/* Left: question list */}
          <div style={{ flex: '0 0 380px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--color-muted)' }}>
              Questions ({questions.length})
            </h3>
            {questions.map((q) => (
              <div
                key={q.id}
                onClick={() => setSelectedQuestionId(q.id)}
                className={`panel ${selectedQuestionId === q.id ? 'panel--selected' : ''}`}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderLeft: selectedQuestionId === q.id ? '3px solid var(--color-primary, #6366f1)' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>{questionStatusIcon(q.status)}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.4 }}>{q.question_text}</p>
                    {q.category && (
                      <span
                        className="badge"
                        style={{ marginTop: '4px', fontSize: '11px' }}
                      >
                        {q.category.replace('_', ' ')}
                      </span>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
                      {q.entry_ids.length} {q.entry_ids.length === 1 ? 'document' : 'documents'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: answer panel */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedQuestionId && (
              <div className="panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-muted)' }}>
                Select a question to see its answer and evidence.
              </div>
            )}

            {selectedQuestionId && (
              <div className="panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Question */}
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Question
                  </div>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>
                    {selectedQuestion?.question_text}
                  </p>
                  {selectedQuestion?.rationale && (
                    <p className="text-muted" style={{ margin: '6px 0 0', fontSize: '13px', fontStyle: 'italic' }}>
                      {selectedQuestion.rationale}
                    </p>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-muted)' }}>
                    {(() => {
                      const n = selectedQuestion?.entry_ids.length ?? 0;
                      return `Involves ${n} ${n === 1 ? 'entry' : 'entries'}`;
                    })()}
                  </div>
                </div>

                {/* Answer loading */}
                {(selectedQuestion?.status === 'queued' || selectedQuestion?.status === 'running') ? (
                  <div style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
                    {questionStatusIcon(selectedQuestion.status)} Generating answer…
                  </div>
                ) : selectedQuestion?.status === 'failed' ? (
                  <div style={{ color: '#ef4444', fontSize: '14px' }}>
                    ❌ Answer generation failed for this question.
                  </div>
                ) : selectedAnswer ? (
                  <>
                    {/* Answer */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Answer
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: confidenceColor(selectedAnswer.confidence) }}>
                            {Math.round(selectedAnswer.confidence * 100)}% confidence
                          </span>
                          <span className="badge" style={{ fontSize: '11px' }}>
                            {selectedAnswer.excerpt_validation === 'pass' ? '✅ evidence verified' : '⚠️ evidence unverified'}
                          </span>
                        </div>
                      </div>
                      <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6 }}>
                        {selectedAnswer.answer_text}
                      </p>
                    </div>

                    {/* Limits */}
                    {selectedAnswer.limits_text && (
                      <div className="settings-message settings-message--info" style={{ margin: 0 }}>
                        <strong>Limitations:</strong> {selectedAnswer.limits_text}
                      </div>
                    )}

                    {/* Evidence */}
                    {selectedAnswer.evidence.length > 0 && (
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                          Evidence ({selectedAnswer.evidence.length} excerpts)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {selectedAnswer.evidence.map((ev, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: 'var(--color-surface-alt, rgba(0,0,0,0.04))',
                                borderLeft: '3px solid var(--color-primary, #6366f1)',
                                padding: '8px 12px',
                                borderRadius: '0 4px 4px 0',
                                fontSize: '13px',
                              }}
                            >
                              <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                                Entry: {ev.entry_id.slice(0, 8)}…
                              </div>
                              <blockquote style={{ margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
                                "{ev.excerpt}"
                              </blockquote>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Promote action */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px' }}>
                      <button
                        className="btn-secondary"
                        onClick={() => handlePromote(selectedAnswer.id)}
                        disabled={promotingId === selectedAnswer.id}
                        style={{ fontSize: '13px' }}
                      >
                        {promotingId === selectedAnswer.id ? '🔄 Promoting...' : '⬆️ Promote to Artifact'}
                      </button>
                      {promoteSuccess === selectedAnswer.id && (
                        <span style={{ fontSize: '13px', color: '#22c55e' }}>
                          ✅ Promoted successfully
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
                    No answer yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


