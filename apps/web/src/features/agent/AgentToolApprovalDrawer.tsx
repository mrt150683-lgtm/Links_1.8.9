/**
 * AgentToolApprovalDrawer
 *
 * Side drawer for reviewing and approving/rejecting generated tools.
 */

import { useAgentTool, useApproveTool, useRejectTool, useDisableTool, useRunTool } from './useAgent';
import './agent.css';

interface Props {
  toolId: string;
  potId: string;
  onClose: () => void;
}

export function AgentToolApprovalDrawer({ toolId, potId, onClose }: Props) {
  const { data: tool, isLoading } = useAgentTool(toolId);
  const approveMut = useApproveTool();
  const rejectMut = useRejectTool();
  const disableMut = useDisableTool();
  const runMut = useRunTool(potId);

  if (isLoading) return (
    <div className="agent-approval-drawer">
      <div className="agent-approval-drawer__header">
        <span className="agent-approval-drawer__title">Loading tool…</span>
        <button className="agent-approval-drawer__close" onClick={onClose}>×</button>
      </div>
    </div>
  );

  if (!tool) return null;

  const testPassed = (tool.test_summary as any)?.passed as boolean | undefined;
  const qualityScore = (tool.test_summary as any)?.quality_score as number | undefined;

  return (
    <div className="agent-approval-drawer">
      <div className="agent-approval-drawer__header">
        <span className="agent-approval-drawer__title">{tool.name}</span>
        <button className="agent-approval-drawer__close" onClick={onClose}>×</button>
      </div>

      <div className="agent-approval-drawer__body">
        {/* Description */}
        {tool.description && (
          <div>
            <div className="agent-approval-drawer__section-title">Description</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #c0b89a)', lineHeight: 1.5 }}>
              {tool.description}
            </div>
          </div>
        )}

        {/* Meta */}
        <div>
          <div className="agent-approval-drawer__section-title">Metadata</div>
          <div className="agent-approval-drawer__meta-row">
            <span className="agent-approval-drawer__meta-label">Language</span>
            <span>{tool.language}</span>
          </div>
          <div className="agent-approval-drawer__meta-row">
            <span className="agent-approval-drawer__meta-label">Status</span>
            <span>{tool.status}</span>
          </div>
          <div className="agent-approval-drawer__meta-row">
            <span className="agent-approval-drawer__meta-label">Version</span>
            <span>v{tool.version}</span>
          </div>
          <div className="agent-approval-drawer__meta-row">
            <span className="agent-approval-drawer__meta-label">Used</span>
            <span>{tool.usage_count}×</span>
          </div>
        </div>

        {/* Capabilities */}
        {tool.capabilities_required.length > 0 && (
          <div>
            <div className="agent-approval-drawer__section-title">Capabilities Required</div>
            <ul className="agent-approval-drawer__capability-list">
              {tool.capabilities_required.map((cap) => (
                <li key={cap}>{cap}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sandbox policy */}
        {tool.sandbox_policy && (
          <div>
            <div className="agent-approval-drawer__section-title">Sandbox Policy</div>
            {Object.entries(tool.sandbox_policy).map(([k, v]) => (
              <div key={k} className="agent-approval-drawer__meta-row">
                <span className="agent-approval-drawer__meta-label">{k}</span>
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Test summary */}
        {tool.test_summary && (
          <div>
            <div className="agent-approval-drawer__section-title">Test Result</div>
            <div className="agent-approval-drawer__test-summary">
              <div>
                Status:{' '}
                {testPassed === true ? (
                  <span className="agent-approval-drawer__test-passed">PASSED</span>
                ) : testPassed === false ? (
                  <span className="agent-approval-drawer__test-failed">FAILED</span>
                ) : (
                  'Unknown'
                )}
              </div>
              {qualityScore !== undefined && (
                <div>Quality score: {Math.round(qualityScore * 100)}%</div>
              )}
            </div>
          </div>
        )}

        {/* Manifest code preview */}
        {tool.manifest && (tool.manifest as any).code_preview && (
          <div>
            <div className="agent-approval-drawer__section-title">Code Preview</div>
            <div className="agent-approval-drawer__code-preview">
              {(tool.manifest as any).code_preview}
            </div>
          </div>
        )}
      </div>

      <div className="agent-approval-drawer__footer">
        {tool.status === 'awaiting_approval' && (
          <>
            <button
              className="agent-approval-drawer__btn agent-approval-drawer__btn--approve"
              onClick={() => approveMut.mutate(toolId)}
              disabled={approveMut.isPending}
            >
              Approve
            </button>
            <button
              className="agent-approval-drawer__btn agent-approval-drawer__btn--reject"
              onClick={() => { rejectMut.mutate(toolId); onClose(); }}
              disabled={rejectMut.isPending}
            >
              Reject
            </button>
          </>
        )}
        {tool.status === 'active' && (
          <>
            <button
              className="agent-approval-drawer__btn agent-approval-drawer__btn--run"
              onClick={() => runMut.mutate({ toolId, inputPayload: {} })}
              disabled={runMut.isPending}
            >
              {runMut.isPending ? 'Running…' : 'Run Now'}
            </button>
            <button
              className="agent-approval-drawer__btn agent-approval-drawer__btn--disable"
              onClick={() => { disableMut.mutate(toolId); onClose(); }}
              disabled={disableMut.isPending}
            >
              Disable
            </button>
          </>
        )}
        {tool.status === 'disabled' && (
          <button
            className="agent-approval-drawer__btn agent-approval-drawer__btn--approve"
            onClick={() => approveMut.mutate(toolId)}
            disabled={approveMut.isPending}
          >
            Re-enable
          </button>
        )}
      </div>
    </div>
  );
}
