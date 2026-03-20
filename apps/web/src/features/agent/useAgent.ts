/**
 * Agent API hooks — React Query wrappers for autonomous agent endpoints.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  pot_id: string;
  enabled: boolean;
  mode: 'quiet' | 'balanced' | 'bold';
  goal_text: string | null;
  cross_pot_enabled: boolean;
  delivery_frequency: string;
  delivery_time_local: string;
  timezone: string;
  max_surprises_per_day: number;
  allow_tool_building: boolean;
  allow_auto_test_low_risk_tools: boolean;
  allow_auto_run_low_risk_tools: boolean;
  quiet_hours: { start: string; end: string } | null;
  created_at: number;
  updated_at: number;
}

export interface AgentRun {
  id: string;
  pot_id: string;
  run_type: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  progress: Record<string, unknown> | null;
  model_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface AgentCandidate {
  id: string;
  pot_id: string;
  run_id: string;
  candidate_type: string;
  title: string;
  body: string;
  confidence: number;
  novelty: number;
  relevance: number;
  final_score: number;
  status: string;
  source_refs: string[];
  launch_payload: Record<string, unknown> | null;
  delivered_at: number | null;
  created_at: number;
}

export interface AgentTool {
  id: string;
  pot_id: string;
  tool_key: string;
  name: string;
  description: string | null;
  language: 'python' | 'javascript';
  status: string;
  version: number;
  manifest: Record<string, unknown> | null;
  capabilities_required: string[];
  sandbox_policy: Record<string, unknown> | null;
  test_summary: Record<string, unknown> | null;
  usage_count: number;
  average_rating: number | null;
  created_at: number;
}

export interface AgentToolRun {
  id: string;
  tool_id: string;
  trigger_type: string;
  status: string;
  started_at: number;
  finished_at: number | null;
}

// ── Intelligence Summary ───────────────────────────────────────────────────

export interface IntelligenceSummary {
  processed_count: number;
  total_eligible: number;
  top_tags: Array<{ label: string; count: number; avg_confidence: number }>;
  top_entities: Array<{ label: string; type: string; count: number }>;
  entity_type_counts: { person: number; org: number; place: number; concept: number };
  entries_status: Record<string, { tags: boolean; entities: boolean; summary: boolean }>;
  recent_links: Array<{
    src_entry_id: string;
    dst_entry_id: string;
    link_type: string;
    confidence: number;
    rationale: string;
  }>;
  latest_candidate: {
    title: string;
    body: string;
    candidate_type: string;
    confidence: number;
  } | null;
}

export function useIntelligenceSummary(potId: string) {
  return useQuery<IntelligenceSummary>({
    queryKey: ['intelligence-summary', potId],
    queryFn: () => api.get<IntelligenceSummary>(`/pots/${potId}/intelligence-summary`),
    refetchInterval: 15_000,
    enabled: !!potId,
  });
}

// ── Config ────────────────────────────────────────────────────────────────

export function useAgentConfig(potId: string) {
  return useQuery<AgentConfig | null>({
    queryKey: ['agent-config', potId],
    queryFn: () =>
      api
        .get<AgentConfig>(`/pots/${potId}/agent-config`)
        .catch((e) => (e?.statusCode === 404 ? null : Promise.reject(e))),
    enabled: !!potId,
  });
}

export function useUpsertAgentConfig(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AgentConfig>) =>
      api.put<AgentConfig>(`/pots/${potId}/agent-config`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-config', potId] }),
  });
}

// ── Runs ─────────────────────────────────────────────────────────────────

export function useAgentRuns(potId: string) {
  return useQuery<{ runs: AgentRun[]; total: number }>({
    queryKey: ['agent-runs', potId],
    queryFn: () => api.get(`/pots/${potId}/agent-runs`),
    enabled: !!potId,
    refetchInterval: 10_000,
  });
}

export function useAgentRun(runId: string) {
  return useQuery<AgentRun>({
    queryKey: ['agent-run', runId],
    queryFn: () => api.get(`/agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) =>
      ['pending', 'running', 'paused'].includes((q.state.data as AgentRun)?.status ?? '')
        ? 3_000
        : false,
  });
}

export function useTriggerAgentRun(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ run_id: string }>(`/pots/${potId}/agent-runs`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-runs', potId] }),
  });
}

export function useCancelAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post(`/agent-runs/${runId}/cancel`, {}),
    onSuccess: (_d, runId) => qc.invalidateQueries({ queryKey: ['agent-run', runId] }),
  });
}

// ── Candidates ────────────────────────────────────────────────────────────

export function useAgentCandidates(potId: string, status?: string) {
  return useQuery<{ candidates: AgentCandidate[]; total: number }>({
    queryKey: ['agent-candidates', potId, status],
    queryFn: () =>
      api.get(`/pots/${potId}/agent-candidates${status ? `?status=${status}` : ''}`),
    enabled: !!potId,
    refetchInterval: 60_000,
  });
}

export function useDeliveredToday(potId: string) {
  return useQuery<{ candidates: AgentCandidate[]; total: number }>({
    queryKey: ['agent-candidates-today', potId],
    queryFn: () => api.get(`/pots/${potId}/agent-candidates?status=delivered`),
    enabled: !!potId,
    refetchInterval: 60_000,
    select: (data) => ({
      ...data,
      candidates: data.candidates.filter((c) => {
        if (!c.delivered_at) return false;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return c.delivered_at >= todayStart.getTime();
      }),
    }),
  });
}

export function useAgentFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      candidateId,
      action,
      potId,
    }: {
      candidateId: string;
      action: string;
      potId: string;
    }) => api.post(`/agent-candidates/${candidateId}/feedback`, { action }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['agent-candidates', vars.potId] });
      qc.invalidateQueries({ queryKey: ['agent-candidates-today', vars.potId] });
    },
  });
}

export function useOpenAgentChat() {
  return useMutation({
    mutationFn: (candidateId: string) =>
      api.post<{ chat_seed: string }>(`/agent-candidates/${candidateId}/open-chat`, {}),
  });
}

// ── Tools ─────────────────────────────────────────────────────────────────

export function useAgentTools(potId: string, status?: string) {
  return useQuery<{ tools: AgentTool[]; total: number }>({
    queryKey: ['agent-tools', potId, status],
    queryFn: () =>
      api.get(`/pots/${potId}/agent-tools${status ? `?status=${status}` : ''}`),
    enabled: !!potId,
  });
}

export function useAgentTool(toolId: string) {
  return useQuery<AgentTool>({
    queryKey: ['agent-tool', toolId],
    queryFn: () => api.get(`/agent-tools/${toolId}`),
    enabled: !!toolId,
  });
}

export function useApproveTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => api.post(`/agent-tools/${toolId}/approve`, {}),
    onSuccess: (_d, toolId) => {
      qc.invalidateQueries({ queryKey: ['agent-tool', toolId] });
      qc.invalidateQueries({ queryKey: ['agent-tools'] });
    },
  });
}

export function useRejectTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => api.post(`/agent-tools/${toolId}/reject`, {}),
    onSuccess: (_d, toolId) => {
      qc.invalidateQueries({ queryKey: ['agent-tool', toolId] });
      qc.invalidateQueries({ queryKey: ['agent-tools'] });
    },
  });
}

export function useDisableTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => api.post(`/agent-tools/${toolId}/disable`, {}),
    onSuccess: (_d, toolId) => {
      qc.invalidateQueries({ queryKey: ['agent-tool', toolId] });
      qc.invalidateQueries({ queryKey: ['agent-tools'] });
    },
  });
}

export function useRunTool(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ toolId, inputPayload }: { toolId: string; inputPayload?: unknown }) =>
      api.post<{ tool_run_id: string }>(`/agent-tools/${toolId}/run`, {
        input_payload: inputPayload ?? {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-tools', potId] }),
  });
}

export function useAgentToolRuns(toolId: string) {
  return useQuery<AgentToolRun[]>({
    queryKey: ['agent-tool-runs', toolId],
    queryFn: () => api.get(`/agent-tool-runs?tool_id=${toolId}`),
    enabled: !!toolId,
  });
}

// ── Tool Rollback ─────────────────────────────────────────────────────

export function useRollbackTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ toolId, versionId }: { toolId: string; versionId: string }) =>
      api.post<{ ok: boolean; rolled_back_to: number }>(
        `/agent-tools/${toolId}/rollback`,
        { version_id: versionId },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['agent-tool', vars.toolId] });
      qc.invalidateQueries({ queryKey: ['agent-tools'] });
    },
  });
}

// ── Tool Versions ─────────────────────────────────────────────────────

export interface AgentToolVersion {
  id: string;
  tool_id: string;
  version: number;
  bundle_hash: string | null;
  manifest: Record<string, unknown> | null;
  build_report_artifact_id: string | null;
  created_at: number;
}

export function useToolVersions(toolId: string) {
  return useQuery<{ versions: AgentToolVersion[] }>({
    queryKey: ['agent-tool-versions', toolId],
    queryFn: () => api.get(`/agent-tools/${toolId}/versions`),
    enabled: !!toolId,
  });
}

// ── Snapshots ─────────────────────────────────────────────────────────

export interface AgentSnapshot {
  id: string;
  pot_id: string;
  manifest: Record<string, unknown> | null;
  status: string;
  created_at: number;
  report: {
    id: string;
    payload: Record<string, unknown> | null;
    created_at: number;
  } | null;
}

export function useAgentSnapshots(potId: string) {
  return useQuery<{ snapshots: AgentSnapshot[] }>({
    queryKey: ['agent-snapshots', potId],
    queryFn: () => api.get(`/agent/pots/${potId}/snapshots`),
    enabled: !!potId,
    refetchInterval: 60_000,
  });
}

// ── Diagnostics ───────────────────────────────────────────────────────────

export function useAgentDiagnostics() {
  return useQuery({
    queryKey: ['agent-diagnostics'],
    queryFn: () => api.get('/agent/diagnostics'),
    refetchInterval: 30_000,
  });
}
