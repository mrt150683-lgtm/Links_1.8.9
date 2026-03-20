/**
 * Project Planning Tab — full workflow component
 *
 * Status flow:
 *   draft → questions_generated → answers_recorded → plan_generated
 *   → approved → phases_generated → docs_generated → exported
 *   → rejected (loops back to plan_generated)
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PlanningRun, PlanningFile, PlanningQuestionsPayload } from '@/lib/types';

// ─── Step helpers ─────────────────────────────────────────────────────────────

const STATUS_STEPS: Record<string, number> = {
  draft: 0,
  questions_generated: 1,
  answers_recorded: 2,
  plan_generated: 3,
  rejected: 3,
  approved: 4,
  phases_generated: 5,
  docs_generated: 6,
  exported: 7,
  failed: -1,
};

const STEP_LABELS = [
  'Setup',
  'Questions',
  'Answers',
  'Plan',
  'Phases',
  'Docs',
  'Export',
];

function stepOf(status: string) {
  return STATUS_STEPS[status] ?? 0;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ProjectPlanningTab({ potId }: { potId: string }) {
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState('software');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Runs list
  const { data: runsData, refetch: refetchRuns } = useQuery({
    queryKey: ['planning-runs', potId],
    queryFn: () => api.get<{ runs: PlanningRun[] }>(`/planning/runs?pot_id=${potId}`),
    enabled: !!potId,
    refetchInterval: 5000,
  });

  const runs = runsData?.runs ?? [];
  const currentRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;

  // Create run
  const createRun = useMutation({
    mutationFn: () =>
      api.post<{ run: PlanningRun }>('/planning/runs', {
        pot_id: potId,
        project_name: projectName.trim() || 'Untitled Project',
        project_type: projectType.trim() || 'software',
      }),
    onSuccess: async (data) => {
      setSelectedRunId(data.run.id);
      setShowNewForm(false);
      setProjectName('');
      setProjectType('software');
      await refetchRuns();
    },
  });

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Project Planning</h2>
        <button className="btn-primary" onClick={() => setShowNewForm((v) => !v)}>
          {showNewForm ? 'Cancel' : '+ New Run'}
        </button>
      </div>

      {/* New run form */}
      {showNewForm && (
        <div className="panel" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', background: 'var(--bg-secondary, #f5f5f5)' }}>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
            style={{ flex: 1, minWidth: 200, padding: 8 }}
          />
          <select
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            style={{ padding: 8 }}
          >
            <option value="software">Software</option>
            <option value="hardware">Hardware</option>
            <option value="fitness">Fitness / Health</option>
            <option value="diet">Diet / Nutrition</option>
            <option value="other">Other</option>
          </select>
          <button className="btn-primary" onClick={() => createRun.mutate()} disabled={createRun.isPending}>
            {createRun.isPending ? 'Creating…' : 'Create Run'}
          </button>
          {createRun.isError && <span style={{ color: 'red', alignSelf: 'center' }}>Failed to create run</span>}
        </div>
      )}

      {/* Run history pills */}
      {runs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="text-muted" style={{ fontSize: 12 }}>Runs:</span>
          {runs.map((run) => (
            <button
              key={run.id}
              className="btn-ghost"
              onClick={() => setSelectedRunId(run.id)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: currentRun?.id === run.id ? '2px solid #6366f1' : '1px solid #ccc',
                fontWeight: currentRun?.id === run.id ? 700 : 400,
              }}
            >
              {run.project_name} · rev {run.revision} ·{' '}
              <span style={{ color: statusColor(run.status) }}>{run.status.replace(/_/g, ' ')}</span>
            </button>
          ))}
        </div>
      )}

      {/* No runs yet */}
      {runs.length === 0 && !showNewForm && (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div>No planning runs yet.</div>
          <div style={{ fontSize: 13 }}>Click <strong>+ New Run</strong> to start generating your project plan.</div>
        </div>
      )}

      {/* Active run workspace */}
      {currentRun && <RunWorkspace run={currentRun} onRefetch={refetchRuns} />}
    </div>
  );
}

// ─── Status colour helper ─────────────────────────────────────────────────────

function statusColor(status: string): string {
  const map: Record<string, string> = {
    draft: '#888',
    questions_generated: '#6366f1',
    answers_recorded: '#0ea5e9',
    plan_generated: '#f59e0b',
    rejected: '#ef4444',
    approved: '#22c55e',
    phases_generated: '#0ea5e9',
    docs_generated: '#6366f1',
    exported: '#22c55e',
    failed: '#ef4444',
  };
  return map[status] ?? '#888';
}

// ─── Run workspace ─────────────────────────────────────────────────────────────

function RunWorkspace({ run, onRefetch }: { run: PlanningRun; onRefetch: () => void }) {
  const step = stepOf(run.status);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  // Questions
  const { data: questionsData, refetch: refetchQuestions } = useQuery({
    queryKey: ['planning-questions', run.id],
    queryFn: () => api.get<{ questions: PlanningQuestionsPayload | null }>(`/planning/runs/${run.id}/questions`),
    enabled: !!run.id && step >= 1,
  });

  // Files
  const { data: filesData, refetch: refetchFiles } = useQuery({
    queryKey: ['planning-files', run.id, run.revision],
    queryFn: () => api.get<{ files: PlanningFile[] }>(`/planning/runs/${run.id}/files?revision=${run.revision}`),
    enabled: !!run.id && step >= 3,
    refetchInterval: step >= 4 ? 5000 : false,
  });

  const files = filesData?.files ?? [];

  // File content viewer
  const { data: fileContent } = useQuery({
    queryKey: ['planning-file-content', run.id, viewingFile],
    queryFn: () => api.get<{ file: PlanningFile }>(`/planning/runs/${run.id}/files/${viewingFile}?revision=${run.revision}`),
    enabled: !!viewingFile,
  });

  // Plan file content (auto-fetch when plan is generated)
  const planFile = files.find((f) => f.path === 'plan.md');
  const { data: planFileContent } = useQuery({
    queryKey: ['planning-plan-content', run.id, run.revision],
    queryFn: () => api.get<{ file: PlanningFile }>(`/planning/runs/${run.id}/files/plan.md?revision=${run.revision}`),
    enabled: !!planFile && (run.status === 'plan_generated' || run.status === 'approved' || run.status === 'rejected'),
  });

  // All mutations
  const generateQuestions = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/questions/generate`, {}),
    onSuccess: async () => { await refetchQuestions(); onRefetch(); },
  });
  const [answers, setAnswers] = useState<Record<string, { status: 'answered' | 'idk' | 'na'; value?: string }>>({});
  const saveAnswers = useMutation({
    mutationFn: () => {
      const payload = {
        answers: Object.entries(answers).map(([question_id, val]) => ({
          question_id,
          status: val.status,
          value: val.value ?? null,
        })),
      };
      return api.put(`/planning/runs/${run.id}/questions/answers`, payload);
    },
    onSuccess: () => onRefetch(),
  });
  const generatePlan = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/plan/generate`, {}),
    onSuccess: () => onRefetch(),
  });
  const [rejectFeedback, setRejectFeedback] = useState('');
  const approvePlan = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/plan/approve`, {}),
    onSuccess: () => onRefetch(),
  });
  const rejectPlan = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/plan/reject`, { feedback: rejectFeedback }),
    onSuccess: () => { setRejectFeedback(''); onRefetch(); },
  });
  const generatePhases = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/phases/generate`, {}),
    onSuccess: () => { onRefetch(); void refetchFiles(); },
  });
  const generateDocs = useMutation({
    mutationFn: () => api.post(`/planning/runs/${run.id}/docs/generate`, {}),
    onSuccess: () => { onRefetch(); void refetchFiles(); },
  });
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const exportZip = useMutation({
    mutationFn: () => api.post<{ job_id: string }>(`/planning/runs/${run.id}/export`, {}),
    onSuccess: (data) => { setExportJobId(data.job_id); void refetchFiles(); },
  });

  const questions = questionsData?.questions?.questions ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Step progress bar */}
      <StepBar step={step} status={run.status} />

      {/* Run meta */}
      <div className="panel" style={{ padding: '8px 12px', fontSize: 13, display: 'flex', gap: 16, flexWrap: 'wrap', background: 'var(--bg-secondary, #f8f8f8)' }}>
        <span><strong>{run.project_name}</strong></span>
        <span className="text-muted">Type: {run.project_type}</span>
        <span className="text-muted">Revision: {run.revision}</span>
        <span style={{ color: statusColor(run.status) }}>● {run.status.replace(/_/g, ' ')}</span>
        {run.rejected_reason && (
          <span style={{ color: '#ef4444' }}>Rejected: {run.rejected_reason}</span>
        )}
      </div>

      {/* ── STEP 0: Draft — generate questions ── */}
      {run.status === 'draft' && (
        <div className="panel" style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ marginBottom: 12 }}>
            Ready to generate <strong>5–20 planning questions</strong> based on your pot's content.
          </p>
          <button
            className="btn-primary"
            onClick={() => generateQuestions.mutate()}
            disabled={generateQuestions.isPending}
          >
            {generateQuestions.isPending ? '⏳ Generating questions…' : 'Generate Questions'}
          </button>
          {generateQuestions.isError && <div style={{ color: 'red', marginTop: 8 }}>Failed — check worker logs</div>}
        </div>
      )}

      {/* ── STEP 1: Questions generated — show + answer ── */}
      {(run.status === 'questions_generated' || (run.status === 'answers_recorded' && questions.length > 0)) && (
        <QuestionsSection
          questions={questions}
          answers={answers}
          setAnswers={setAnswers}
          onSave={() => saveAnswers.mutate()}
          saving={saveAnswers.isPending}
          saved={run.status === 'answers_recorded'}
          error={saveAnswers.isError}
        />
      )}

      {/* ── STEP 2: Answers recorded — waiting for plan / trigger ── */}
      {run.status === 'answers_recorded' && (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>✅ Answers saved. Ready to generate the plan.</div>
          <button
            className="btn-primary"
            onClick={() => generatePlan.mutate()}
            disabled={generatePlan.isPending}
          >
            {generatePlan.isPending ? '⏳ Generating plan…' : 'Generate Plan'}
          </button>
          {generatePlan.isError && <div style={{ color: 'red', marginTop: 8 }}>Plan generation failed</div>}
        </div>
      )}

      {/* ── STEP 3: Plan generated / rejected — preview + approve/reject ── */}
      {(run.status === 'plan_generated' || run.status === 'rejected') && (
        <PlanReviewSection
          planContent={planFileContent?.file?.content_text ?? null}
          status={run.status}
          rejectedReason={run.rejected_reason}
          rejectFeedback={rejectFeedback}
          setRejectFeedback={setRejectFeedback}
          onApprove={() => approvePlan.mutate()}
          onReject={() => rejectPlan.mutate()}
          onRegenerate={() => generatePlan.mutate()}
          approving={approvePlan.isPending}
          rejecting={rejectPlan.isPending}
          regenerating={generatePlan.isPending}
        />
      )}

      {/* ── STEP 4: Approved — generate phases ── */}
      {run.status === 'approved' && (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>✅ Plan approved! Now generate the phase documents.</div>
          <button
            className="btn-primary"
            onClick={() => generatePhases.mutate()}
            disabled={generatePhases.isPending}
          >
            {generatePhases.isPending ? '⏳ Generating phases…' : 'Generate Phases'}
          </button>
          {generatePhases.isError && <div style={{ color: 'red', marginTop: 8 }}>Phase generation failed</div>}
        </div>
      )}

      {/* ── STEP 5: Phases generated — generate extra docs ── */}
      {run.status === 'phases_generated' && (
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>✅ Phases generated! Generate additional documentation (architecture, security, QA, etc.).</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-primary"
              onClick={() => generateDocs.mutate()}
              disabled={generateDocs.isPending}
            >
              {generateDocs.isPending ? '⏳ Generating docs…' : 'Generate Extra Docs'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => exportZip.mutate()}
              disabled={exportZip.isPending}
            >
              Skip — Export Now
            </button>
          </div>
          {generateDocs.isError && <div style={{ color: 'red', marginTop: 8 }}>Doc generation failed</div>}
        </div>
      )}

      {/* ── STEP 6: Docs generated / exported — export ── */}
      {(run.status === 'docs_generated' || run.status === 'exported') && (
        <div className="panel" style={{ padding: 16 }}>
          {run.status === 'docs_generated' && (
            <div style={{ marginBottom: 12 }}>✅ All docs generated! Export the full project as a ZIP archive.</div>
          )}
          {run.status === 'exported' && (
            <div style={{ marginBottom: 12, color: '#22c55e' }}>✅ Project exported successfully!</div>
          )}
          <button
            className="btn-primary"
            onClick={() => exportZip.mutate()}
            disabled={exportZip.isPending}
          >
            {exportZip.isPending ? '⏳ Exporting…' : run.status === 'exported' ? 'Re-export ZIP' : 'Export ZIP'}
          </button>
          {exportJobId && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
              Export job queued: <code>{exportJobId}</code>
            </div>
          )}
        </div>
      )}

      {/* ── Failed state ── */}
      {run.status === 'failed' && (
        <div className="panel" style={{ padding: 16, borderLeft: '3px solid #ef4444' }}>
          <strong style={{ color: '#ef4444' }}>Run failed.</strong>
          <div style={{ marginTop: 4, fontSize: 13 }}>Check the Jobs page for error details. You may need to requeue the failed job.</div>
        </div>
      )}

      {/* ── Generated files browser ── */}
      {files.length > 0 && (
        <FileBrowser
          files={files}
          viewingFile={viewingFile}
          setViewingFile={setViewingFile}
          fileContent={viewingFile && fileContent?.file ? fileContent.file : null}
        />
      )}
    </div>
  );
}

// ─── Step progress bar ─────────────────────────────────────────────────────────

function StepBar({ step, status }: { step: number; status: string }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
      {STEP_LABELS.map((label, i) => {
        const active = i === Math.min(step, STEP_LABELS.length - 1);
        const done = i < step && status !== 'rejected';
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && (
              <div
                style={{
                  width: 24,
                  height: 2,
                  background: done ? '#22c55e' : '#ddd',
                }}
              />
            )}
            <div
              style={{
                padding: '3px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                background: done ? '#22c55e' : active ? '#6366f1' : '#eee',
                color: done || active ? '#fff' : '#666',
              }}
            >
              {label}
            </div>
          </div>
        );
      })}
      {status === 'rejected' && (
        <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 8 }}>⚠ Rejected — re-generate plan</span>
      )}
    </div>
  );
}

// ─── Questions section ─────────────────────────────────────────────────────────

interface AnswerState {
  status: 'answered' | 'idk' | 'na';
  value?: string;
}

interface QuestionsSectionProps {
  questions: PlanningQuestionsPayload['questions'];
  answers: Record<string, AnswerState>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, AnswerState>>>;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: boolean;
}

function QuestionsSection({ questions, answers, setAnswers, onSave, saving, saved, error }: QuestionsSectionProps) {
  if (questions.length === 0) {
    return <div style={{ padding: 16, color: '#888' }}>⏳ Questions are being generated — check back shortly…</div>;
  }

  const answeredCount = Object.values(answers).filter((a) => a.status !== undefined).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>Planning Questions ({questions.length})</h4>
        <span className="text-muted" style={{ fontSize: 12 }}>{answeredCount}/{questions.length} answered</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {questions.map((q, idx) => {
          const ans = answers[q.id];
          const isIdk = ans?.status === 'idk';
          const isNa = ans?.status === 'na';

          return (
            <div
              key={q.id}
              className="panel"
              style={{
                padding: 12,
                borderLeft: ans ? '3px solid #22c55e' : '3px solid transparent',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: '#888', fontSize: 12, minWidth: 20 }}>Q{idx + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{q.question}</div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{q.why_it_matters}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {!isIdk && !isNa && (
                      <input
                        value={ans?.value ?? ''}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [q.id]: { status: 'answered', value: e.target.value } }))
                        }
                        placeholder="Your answer…"
                        style={{ flex: 1, minWidth: 220, padding: 8 }}
                      />
                    )}
                    {q.allow_idk && (
                      <button
                        className={isIdk ? 'btn-primary' : 'btn-ghost'}
                        style={{ fontSize: 12 }}
                        onClick={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [q.id]: isIdk ? { status: 'answered', value: '' } : { status: 'idk' },
                          }))
                        }
                      >
                        {isIdk ? '✓ I don\'t know' : 'I don\'t know'}
                      </button>
                    )}
                    {q.allow_na && (
                      <button
                        className={isNa ? 'btn-primary' : 'btn-ghost'}
                        style={{ fontSize: 12 }}
                        onClick={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [q.id]: isNa ? { status: 'answered', value: '' } : { status: 'na' },
                          }))
                        }
                      >
                        {isNa ? '✓ N/A' : 'N/A'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-primary" onClick={onSave} disabled={saving || answeredCount === 0}>
          {saving ? 'Saving…' : saved ? '✓ Answers Saved — Continue' : 'Save Answers & Continue'}
        </button>
        {error && <span style={{ color: 'red', fontSize: 13 }}>Failed to save</span>}
      </div>
    </div>
  );
}

// ─── Plan review section ───────────────────────────────────────────────────────

interface PlanReviewProps {
  planContent: string | null;
  status: string;
  rejectedReason: string | null;
  rejectFeedback: string;
  setRejectFeedback: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  approving: boolean;
  rejecting: boolean;
  regenerating: boolean;
}

function PlanReviewSection({
  planContent,
  status,
  rejectedReason,
  rejectFeedback,
  setRejectFeedback,
  onApprove,
  onReject,
  onRegenerate,
  approving,
  rejecting,
  regenerating,
}: PlanReviewProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {status === 'rejected' && (
        <div className="panel" style={{ padding: 12, borderLeft: '3px solid #ef4444' }}>
          <strong style={{ color: '#ef4444' }}>Plan rejected.</strong>
          {rejectedReason && <div style={{ marginTop: 4, fontSize: 13 }}>Reason: {rejectedReason}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? '⏳ Regenerating…' : 'Regenerate Plan'}
            </button>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong>plan.md</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            {status === 'plan_generated' && (
              <>
                <button className="btn-primary" onClick={onApprove} disabled={approving}>
                  {approving ? 'Approving…' : '✓ Approve Plan'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setShowRejectForm((v) => !v)}
                  style={{ color: '#ef4444', borderColor: '#ef4444' }}
                >
                  {showRejectForm ? 'Cancel' : '✗ Reject'}
                </button>
              </>
            )}
          </div>
        </div>

        {showRejectForm && (
          <div style={{ padding: 12, background: '#fff3f3', borderBottom: '1px solid #eee' }}>
            <textarea
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              placeholder="What should be changed? (required)"
              rows={3}
              style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
            />
            <button
              className="btn-secondary"
              style={{ marginTop: 8, color: '#ef4444', borderColor: '#ef4444' }}
              disabled={rejectFeedback.trim().length < 3 || rejecting}
              onClick={() => { onReject(); setShowRejectForm(false); }}
            >
              {rejecting ? 'Rejecting…' : 'Submit Rejection'}
            </button>
          </div>
        )}

        <div style={{ padding: 16 }}>
          {planContent == null ? (
            <div style={{ color: '#888', textAlign: 'center', padding: 24 }}>
              ⏳ Plan is being generated — refresh in a moment…
            </div>
          ) : (
            <pre style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'inherit',
              fontSize: 14,
              lineHeight: 1.7,
              margin: 0,
              maxHeight: 500,
              overflowY: 'auto',
            }}>
              {planContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── File browser ──────────────────────────────────────────────────────────────

interface FileBrowserProps {
  files: PlanningFile[];
  viewingFile: string | null;
  setViewingFile: (path: string | null) => void;
  fileContent: PlanningFile | null;
}

function FileBrowser({ files, viewingFile, setViewingFile, fileContent }: FileBrowserProps) {
  // Group files by directory
  const grouped: Record<string, PlanningFile[]> = {};
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.split('/')[0]! : 'root';
    grouped[dir] = [...(grouped[dir] ?? []), f];
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #333', fontWeight: 600, fontSize: 13, background: '#2a2a2a', color: '#ccc' }}>
        Generated Files ({files.length})
      </div>
      <div style={{ display: 'flex', minHeight: 200 }}>
        {/* File list */}
        <div style={{ width: 240, borderRight: '1px solid #333', overflowY: 'auto', maxHeight: 400, background: '#252525' }}>
          {files.map((f) => (
            <button
              key={`${f.path}-${f.revision}`}
              onClick={() => setViewingFile(viewingFile === f.path ? null : f.path)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: viewingFile === f.path ? '#3a3a5c' : 'transparent',
                border: 'none',
                borderBottom: '1px solid #333',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: viewingFile === f.path ? 600 : 400,
                color: viewingFile === f.path ? '#a5b4fc' : '#ccc',
              }}
            >
              <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{f.path}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{f.kind}</div>
            </button>
          ))}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, padding: 16, overflowY: 'auto', maxHeight: 400, background: '#2a2a2a' }}>
          {!viewingFile && (
            <div style={{ color: '#777', textAlign: 'center', paddingTop: 40, fontSize: 13 }}>
              Select a file to view its content
            </div>
          )}
          {viewingFile && fileContent == null && (
            <div style={{ color: '#888', fontSize: 13 }}>Loading…</div>
          )}
          {viewingFile && fileContent != null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <code style={{ fontSize: 12, color: '#ccc' }}>{fileContent.path}</code>
                <button className="btn-ghost" style={{ fontSize: 11, color: '#aaa' }} onClick={() => setViewingFile(null)}>✕</button>
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: 1.6,
                margin: 0,
                background: '#222',
                color: '#e0e0e0',
                padding: 12,
                borderRadius: 4,
              }}>
                {fileContent.content_text ?? '(empty)'}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
