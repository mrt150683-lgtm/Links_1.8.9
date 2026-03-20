/**
 * AgentToolLibrary
 *
 * Tabbed view of generated tools: Active / Awaiting Approval / Disabled / Archived / Failed
 * Includes version history expand + rollback per version.
 */

import { useState } from 'react';
import { useAgentTools, useToolVersions, useRollbackTool } from './useAgent';
import type { AgentTool, AgentToolVersion } from './useAgent';
import { AgentToolApprovalDrawer } from './AgentToolApprovalDrawer';
import './agent.css';

type TabKey = 'awaiting_approval' | 'active' | 'disabled' | 'rejected' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'awaiting_approval', label: 'Awaiting Approval' },
  { key: 'active', label: 'Active' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'rejected', label: 'Rejected / Failed' },
  { key: 'all', label: 'All' },
];

interface Props {
  potId: string;
}

export function AgentToolLibrary({ potId }: Props) {
  const [tab, setTab] = useState<TabKey>('awaiting_approval');
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const status = tab === 'all' ? undefined : tab;
  const { data, isLoading } = useAgentTools(potId, status);
  const tools = data?.tools ?? [];

  return (
    <div className="agent-tool-library">
      <div className="agent-tool-library__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`agent-tool-library__tab${tab === t.key ? ' agent-tool-library__tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="agent-loading">Loading tools…</div>}

      {!isLoading && tools.length === 0 && (
        <div className="agent-page__empty">
          No tools in this category yet.
          {tab === 'awaiting_approval' && ' Tools will appear here after the agent generates and tests them.'}
        </div>
      )}

      {tools.map((tool) => (
        <div key={tool.id}>
          <ToolRow
            tool={tool}
            onClick={() => setSelectedToolId(tool.id)}
            onToggleVersions={() =>
              setExpandedToolId(expandedToolId === tool.id ? null : tool.id)
            }
            isExpanded={expandedToolId === tool.id}
          />
          {expandedToolId === tool.id && (
            <ToolVersionHistory toolId={tool.id} />
          )}
        </div>
      ))}

      {selectedToolId && (
        <AgentToolApprovalDrawer
          toolId={selectedToolId}
          potId={potId}
          onClose={() => setSelectedToolId(null)}
        />
      )}
    </div>
  );
}

function ToolRow({
  tool,
  onClick,
  onToggleVersions,
  isExpanded,
}: {
  tool: AgentTool;
  onClick: () => void;
  onToggleVersions: () => void;
  isExpanded: boolean;
}) {
  return (
    <div className="agent-tool-row" onClick={onClick}>
      <span className="agent-tool-row__name">{tool.name}</span>
      <span className="agent-tool-row__desc">{tool.description ?? '—'}</span>
      <span className="agent-tool-row__lang">{tool.language}</span>
      <span className={`agent-tool-row__status agent-tool-row__status--${tool.status}`}>
        {tool.status.replace(/_/g, ' ')}
      </span>
      <button
        className="agent-tool-row__versions-btn"
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 8,
          border: '1px solid var(--border, #3a3a3a)',
          background: isExpanded ? 'rgba(201,162,39,0.1)' : 'transparent',
          color: 'var(--text-muted, #888)',
          cursor: 'pointer',
          marginLeft: 8,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVersions();
        }}
      >
        v{tool.version} {isExpanded ? '▲' : '▼'}
      </button>
    </div>
  );
}

function ToolVersionHistory({ toolId }: { toolId: string }) {
  const { data, isLoading } = useToolVersions(toolId);
  const rollback = useRollbackTool();
  const versions = data?.versions ?? [];

  if (isLoading) return <div style={{ padding: '8px 16px', fontSize: 11, color: '#888' }}>Loading versions…</div>;
  if (versions.length === 0) return <div style={{ padding: '8px 16px', fontSize: 11, color: '#666' }}>No previous versions.</div>;

  return (
    <div style={{ padding: '4px 16px 12px', borderLeft: '2px solid var(--border, #3a3a3a)', marginLeft: 16 }}>
      {versions.map((v: AgentToolVersion) => (
        <div
          key={v.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 0',
            fontSize: 11,
            color: '#aaa',
          }}
        >
          <span style={{ fontWeight: 600 }}>v{v.version}</span>
          <span>{v.bundle_hash ? `#${v.bundle_hash.slice(0, 8)}` : '—'}</span>
          <span>{new Date(v.created_at).toLocaleDateString()}</span>
          <button
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 6,
              border: '1px solid #c44',
              background: 'transparent',
              color: '#c44',
              cursor: 'pointer',
            }}
            disabled={rollback.isPending}
            onClick={() => rollback.mutate({ toolId, versionId: v.id })}
          >
            {rollback.isPending ? '…' : 'Rollback'}
          </button>
        </div>
      ))}
    </div>
  );
}
