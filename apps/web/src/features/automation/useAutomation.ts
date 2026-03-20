/**
 * useAutomation — React Query hooks for the Automation & Heartbeat subsystem
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────

export interface PotAutomationSettings {
  id: string;
  pot_id: string;
  enabled: boolean;
  heartbeat_enabled: boolean;
  agent_task_management_enabled: boolean;
  agent_can_create_tasks: boolean;
  agent_can_update_tasks: boolean;
  agent_can_complete_tasks: boolean;
  agent_can_render_heartbeat_md: boolean;
  default_model: string | null;
  timezone: string | null;
  quiet_hours_json: string | null;
  max_tasks_created_per_day: number;
  max_heartbeat_runs_per_day: number;
  proactive_conversations_enabled: boolean;
  proactive_conversation_model: string | null;
  created_at: number;
  updated_at: number;
}

export interface HeartbeatSnapshot {
  id: string;
  pot_id: string;
  period_key: string;
  snapshot: {
    headline?: string;
    summary?: string;
    what_changed?: string;
    open_loops?: Array<{ title: string; description: string; priority: string }>;
    risks?: Array<{ title: string; description: string; severity: string }>;
    recommended_actions?: Array<{ action: string; rationale: string; urgency: string }>;
    confidence?: number;
    reasoning_basis?: string;
  };
  summary: {
    headline?: string;
    summary?: string;
    what_changed?: string;
    confidence?: number;
  } | null;
  open_loops: unknown[];
  proposed_tasks: unknown[];
  model_id: string;
  prompt_id: string;
  prompt_version: string;
  input_fingerprint: string | null;
  created_at: number;
}

export interface HeartbeatDocument {
  id: string;
  pot_id: string;
  heartbeat_snapshot_id: string;
  format: string;
  content_text: string;
  created_at: number;
}

export interface ScheduledTask {
  id: string;
  pot_id: string;
  task_type: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'canceled';
  schedule_kind: 'cron' | 'once' | 'manual' | 'event';
  cron_like: string | null;
  run_at: number | null;
  timezone: string | null;
  created_by: 'user' | 'system' | 'agent';
  created_from: string;
  last_run_at: number | null;
  next_run_at: number | null;
  last_result_status: string | null;
  last_result_summary: string | null;
  priority: number;
  created_at: number;
  updated_at: number;
}

export interface TaskRun {
  id: string;
  task_id: string;
  pot_id: string;
  job_id: string | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  started_at: number | null;
  finished_at: number | null;
  model_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  result_json: unknown | null;
  error_text: string | null;
}

export interface AutomationPrefs {
  enabled?: boolean;
  default_heartbeat_model?: string;
  default_timezone?: string;
}

// ── Settings ─────────────────────────────────────────────────────────

export function useAutomationSettings(potId: string) {
  return useQuery({
    queryKey: ['automation-settings', potId],
    queryFn: () => api.get<{ settings: PotAutomationSettings }>(`/pots/${potId}/automation`).then(r => r.settings),
    enabled: !!potId,
  });
}

export function useUpsertAutomationSettings(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PotAutomationSettings>) =>
      api.put<{ settings: PotAutomationSettings }>(`/pots/${potId}/automation`, patch as any).then(r => r.settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-settings', potId] });
    },
  });
}

export function useGlobalAutomationPrefs() {
  return useQuery({
    queryKey: ['automation-prefs-global'],
    queryFn: () => api.get<{ prefs: AutomationPrefs }>('/prefs/automation').then(r => r.prefs),
  });
}

export function useUpdateGlobalAutomationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: AutomationPrefs) =>
      api.put<{ prefs: AutomationPrefs }>('/prefs/automation', prefs as any).then(r => r.prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-prefs-global'] });
    },
  });
}

// ── Heartbeat ─────────────────────────────────────────────────────────

export function useLatestHeartbeat(potId: string) {
  return useQuery({
    queryKey: ['heartbeat-latest', potId],
    queryFn: () => api.get<{ snapshot: HeartbeatSnapshot | null; document: HeartbeatDocument | null }>(`/pots/${potId}/heartbeat/latest`),
    enabled: !!potId,
    refetchInterval: 60_000,
  });
}

export function useHeartbeatHistory(potId: string, limit = 20) {
  return useQuery({
    queryKey: ['heartbeat-history', potId, limit],
    queryFn: () => api.get<{ snapshots: HeartbeatSnapshot[]; total: number }>(`/pots/${potId}/heartbeat/history?limit=${limit}`),
    enabled: !!potId,
  });
}

export function useRunHeartbeat(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/pots/${potId}/heartbeat/run`, {}),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['heartbeat-latest', potId] });
        qc.invalidateQueries({ queryKey: ['heartbeat-history', potId] });
      }, 5000);
    },
  });
}

export function useRenderHeartbeat(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/pots/${potId}/heartbeat/render`, {}),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['heartbeat-latest', potId] }), 3000);
    },
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────

export function usePotTasks(potId: string, filters?: { status?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString() ? `?${params}` : '';

  return useQuery({
    queryKey: ['tasks', potId, filters],
    queryFn: () => api.get<{ tasks: ScheduledTask[]; total: number }>(`/pots/${potId}/tasks${qs}`),
    enabled: !!potId,
    refetchInterval: 30_000,
  });
}

export function useCreateTask(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      description?: string;
      task_type?: string;
      schedule_kind: string;
      cron_like?: string;
      run_at?: number;
      timezone?: string;
      priority?: number;
    }) => api.post<{ task: ScheduledTask }>(`/pots/${potId}/tasks`, input as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', potId] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...patch }: { taskId: string; [key: string]: unknown }) =>
      api.patch<{ task: ScheduledTask }>(`/tasks/${taskId}`, patch as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post<{ task: ScheduledTask }>(`/tasks/${taskId}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function usePauseTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post<{ task: ScheduledTask }>(`/tasks/${taskId}/pause`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useResumeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post<{ task: ScheduledTask }>(`/tasks/${taskId}/resume`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useRunTaskNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.post<{ ok: boolean }>(`/tasks/${taskId}/run-now`, {}),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['tasks'] }), 3000);
    },
  });
}

export function useSeedTasks(potId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ created: ScheduledTask[]; skipped: string[] }>(`/pots/${potId}/automation/seed-tasks`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', potId] });
    },
  });
}

// ── Diagnostics ───────────────────────────────────────────────────────

export function useAutomationRuns(potId: string, limit = 50) {
  return useQuery({
    queryKey: ['automation-runs', potId, limit],
    queryFn: () => api.get<{ runs: TaskRun[]; total: number }>(`/pots/${potId}/automation/runs?limit=${limit}`),
    enabled: !!potId,
    refetchInterval: 15_000,
  });
}
