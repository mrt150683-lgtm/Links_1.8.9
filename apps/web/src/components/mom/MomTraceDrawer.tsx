/**
 * MomTraceDrawer
 *
 * Collapsible side-panel / overlay showing the full trace of a MoM run:
 * planner decision, per-agent role + answer + confidence, disagreements,
 * trace summary.
 *
 * Opens when the user clicks "View trace" in MomStatusStrip.
 */

import { useEffect, useState } from 'react';
import './MomTraceDrawer.css';

interface AgentOutput {
  role: string;
  summary: string;
  answer: string;
  claims: string[];
  assumptions: string[];
  evidence_refs: string[];
  missing_context: string[];
  risks: string[];
  confidence: number;
}

interface ReviewOutput {
  target_agent_role: string;
  verdict: 'accept' | 'partial' | 'reject';
  supported_claims: string[];
  challenged_claims: string[];
  fabrications: string[];
  missing_perspectives: string[];
  suggested_additions: string[];
  confidence_delta: number;
  notes: string;
}

interface ChatRunReview {
  id: string;
  chat_run_id: string;
  target_agent_id: string | null;
  model_id: string;
  review_output: ReviewOutput | null;
  latency_ms: number | null;
}

interface ChatRunAgent {
  id: string;
  agent_index: number;
  agent_role: string;
  status: string;
  output: AgentOutput | null;
  latency_ms: number | null;
  error_message: string | null;
}

interface PlannerOutput {
  should_use_mom: boolean;
  execution_mode: string;
  recommended_agent_count: number;
  decomposition_strategy: string;
  reason: string;
  agent_roles: Array<{ role: string; focus: string }>;
}

interface FinalOutput {
  final_answer: string;
  consensus_points: string[];
  disagreements: string[];
  rejected_claims: string[];
  missing_context: string[];
  confidence: number;
  trace_summary: string;
}

interface ChatRun {
  id: string;
  status: string;
  execution_mode: string;
  planner_output: PlannerOutput | null;
  final_output: FinalOutput | null;
  started_at: number | null;
  finished_at: number | null;
}

interface MomTraceDrawerProps {
  runId: string | null;
  onClose: () => void;
}

const VERDICT_LABEL: Record<string, string> = {
  accept: 'Accepted',
  partial: 'Partial',
  reject: 'Rejected',
};

function ReviewCard({ review }: { review: ChatRunReview }) {
  const [expanded, setExpanded] = useState(false);
  const out = review.review_output;
  if (!out) return null;

  const verdictCls = `mom-trace__review-verdict mom-trace__review-verdict--${out.verdict}`;

  return (
    <div className="mom-trace__review">
      <div className="mom-trace__review-header" onClick={() => setExpanded((v) => !v)}>
        <span className="mom-trace__review-label">Review</span>
        <span className={verdictCls}>{VERDICT_LABEL[out.verdict] ?? out.verdict}</span>
        {out.confidence_delta !== 0 && (
          <span className={`mom-trace__confidence-delta ${out.confidence_delta < 0 ? 'neg' : 'pos'}`}>
            {out.confidence_delta > 0 ? '+' : ''}{Math.round(out.confidence_delta * 100)}%
          </span>
        )}
        <span className="mom-trace__expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {out.notes && <div className="mom-trace__review-notes">{out.notes}</div>}

      {expanded && (
        <div className="mom-trace__review-detail">
          {out.challenged_claims.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Challenged claims</div>
              <ul className="mom-trace__list mom-trace__list--challenged">
                {out.challenged_claims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {out.fabrications.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Unsupported / fabricated</div>
              <ul className="mom-trace__list mom-trace__list--fabrication">
                {out.fabrications.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
          {out.missing_perspectives.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Missing perspectives</div>
              <ul className="mom-trace__list">
                {out.missing_perspectives.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {out.suggested_additions.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Suggested additions</div>
              <ul className="mom-trace__list">
                {out.suggested_additions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';
  return <span className={`mom-trace__confidence mom-trace__confidence--${cls}`}>{pct}%</span>;
}

function AgentCard({ agent, review }: { agent: ChatRunAgent; review?: ChatRunReview }) {
  const [expanded, setExpanded] = useState(false);
  const output = agent.output;

  return (
    <div className={`mom-trace__agent ${agent.status === 'failed' ? 'mom-trace__agent--failed' : ''}`}>
      <div className="mom-trace__agent-header" onClick={() => setExpanded((v) => !v)}>
        <span className="mom-trace__agent-index">{agent.agent_index + 1}</span>
        <span className="mom-trace__agent-role">{agent.agent_role}</span>
        {output && <ConfidenceBadge value={output.confidence} />}
        {agent.latency_ms != null && (
          <span className="mom-trace__latency">{(agent.latency_ms / 1000).toFixed(1)}s</span>
        )}
        {agent.status === 'failed' && <span className="mom-trace__failed-badge">failed</span>}
        <span className="mom-trace__expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {output && (
        <div className="mom-trace__agent-summary">{output.summary}</div>
      )}

      {expanded && output && (
        <div className="mom-trace__agent-detail">
          <div className="mom-trace__section">
            <div className="mom-trace__section-label">Answer</div>
            <div className="mom-trace__answer">{output.answer}</div>
          </div>

          {output.evidence_refs.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Evidence</div>
              {output.evidence_refs.map((r, i) => (
                <blockquote key={i} className="mom-trace__evidence">{r}</blockquote>
              ))}
            </div>
          )}

          {output.risks.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Risks / Caveats</div>
              <ul className="mom-trace__list">
                {output.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          {output.missing_context.length > 0 && (
            <div className="mom-trace__section">
              <div className="mom-trace__section-label">Missing context</div>
              <ul className="mom-trace__list">
                {output.missing_context.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {expanded && agent.status === 'failed' && agent.error_message && (
        <div className="mom-trace__agent-error">{agent.error_message}</div>
      )}

      {review && <ReviewCard review={review} />}
    </div>
  );
}

export default function MomTraceDrawer({ runId, onClose }: MomTraceDrawerProps) {
  const [run, setRun] = useState<ChatRun | null>(null);
  const [agents, setAgents] = useState<ChatRunAgent[]>([]);
  const [reviews, setReviews] = useState<ChatRunReview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setRun(null);
    setAgents([]);
    setReviews([]);

    fetch(`/api/mom/runs/${runId}`)
      .then((r) => r.json())
      .then((data) => {
        setRun(data.run ?? null);
        setAgents(data.agents ?? []);
        setReviews(data.reviews ?? []);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, [runId]);

  if (!runId) return null;

  const planner = run?.planner_output;
  const finalOutput = run?.final_output;

  return (
    <div className="mom-trace__overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mom-trace__drawer">
        <div className="mom-trace__header">
          <span className="mom-trace__title">◈ MoM Trace</span>
          {run && (
            <span className="mom-trace__mode">{run.execution_mode}</span>
          )}
          <button className="mom-trace__close" onClick={onClose}>×</button>
        </div>

        {loading && <div className="mom-trace__loading">Loading trace…</div>}

        {!loading && run && (
          <div className="mom-trace__body">
            {/* Planner decision */}
            {planner && (
              <div className="mom-trace__planner">
                <div className="mom-trace__section-title">Planner Decision</div>
                <div className="mom-trace__planner-row">
                  <span className="mom-trace__kv-key">Mode</span>
                  <span>{planner.execution_mode}</span>
                </div>
                <div className="mom-trace__planner-row">
                  <span className="mom-trace__kv-key">Agents</span>
                  <span>{planner.recommended_agent_count}</span>
                </div>
                <div className="mom-trace__planner-row">
                  <span className="mom-trace__kv-key">Strategy</span>
                  <span>{planner.decomposition_strategy}</span>
                </div>
                <div className="mom-trace__planner-row">
                  <span className="mom-trace__kv-key">Reason</span>
                  <span>{planner.reason}</span>
                </div>
              </div>
            )}

            {/* Agents */}
            {agents.length > 0 && (
              <div className="mom-trace__agents-section">
                <div className="mom-trace__section-title">
                  Specialist Agents ({agents.length})
                  {reviews.length > 0 && (
                    <span className="mom-trace__reviewed-badge">reviewed</span>
                  )}
                </div>
                {agents.map((a) => {
                  // Match review by target_agent_role from review output
                  const review = reviews.find(
                    (r) => r.review_output?.target_agent_role === a.agent_role
                  );
                  return <AgentCard key={a.id} agent={a} review={review} />;
                })}
              </div>
            )}

            {/* Merge output */}
            {finalOutput && (
              <div className="mom-trace__merge">
                <div className="mom-trace__section-title">
                  Merge Summary
                  <ConfidenceBadge value={finalOutput.confidence} />
                </div>

                {finalOutput.trace_summary && (
                  <div className="mom-trace__trace-summary">{finalOutput.trace_summary}</div>
                )}

                {finalOutput.consensus_points.length > 0 && (
                  <div className="mom-trace__section">
                    <div className="mom-trace__section-label">Consensus</div>
                    <ul className="mom-trace__list mom-trace__list--consensus">
                      {finalOutput.consensus_points.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}

                {finalOutput.disagreements.length > 0 && (
                  <div className="mom-trace__section">
                    <div className="mom-trace__section-label">Disagreements</div>
                    <ul className="mom-trace__list mom-trace__list--disagreement">
                      {finalOutput.disagreements.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}

                {finalOutput.rejected_claims.length > 0 && (
                  <div className="mom-trace__section">
                    <div className="mom-trace__section-label">Rejected claims</div>
                    <ul className="mom-trace__list mom-trace__list--rejected">
                      {finalOutput.rejected_claims.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}

                {finalOutput.missing_context.length > 0 && (
                  <div className="mom-trace__section">
                    <div className="mom-trace__section-label">Unresolved gaps</div>
                    <ul className="mom-trace__list">
                      {finalOutput.missing_context.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
