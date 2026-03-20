/**
 * TasksPanel
 *
 * Scheduled task list for a pot: active, scheduled, overdue, completed.
 * Supports create, pause, resume, run-now, complete.
 */

import { useState } from 'react';
import {
  usePotTasks,
  useCreateTask,
  useCompleteTask,
  usePauseTask,
  useResumeTask,
  useRunTaskNow,
  useSeedTasks,
  type ScheduledTask,
} from './useAutomation';

interface Props {
  potId: string;
}

type StatusFilter = 'active' | 'completed' | 'paused' | 'all';

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const diffMs = ts - Date.now();
  if (diffMs < 0) return `Overdue (${d.toLocaleDateString()})`;
  if (diffMs < 3_600_000) return `in ${Math.round(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `in ${Math.round(diffMs / 3_600_000)}h`;
  return d.toLocaleDateString();
}

function CreatorBadge({ creator }: { creator: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    user: { bg: '#2d4a7a', text: '#90cdf4' },
    agent: { bg: '#3d3020', text: '#c9a227' },
    system: { bg: '#2d3748', text: '#a0aec0' },
  };
  const style = colors[creator] ?? colors.system;
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 6px',
      borderRadius: 4,
      background: style.bg,
      color: style.text,
      fontWeight: 600,
    }}>
      {creator}
    </span>
  );
}

function TaskRow({ task }: { task: ScheduledTask; potId: string }) {
  const completeMut = useCompleteTask();
  const pauseMut = usePauseTask();
  const resumeMut = useResumeTask();
  const runNowMut = useRunTaskNow();

  const isOverdue = task.next_run_at !== null && task.next_run_at <= Date.now() && task.status === 'active';

  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-secondary)',
      borderRadius: 6,
      borderLeft: `3px solid ${isOverdue ? '#fc8181' : task.status === 'completed' ? '#68d391' : task.status === 'paused' ? '#888' : 'var(--gold)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{task.title}</span>
            <CreatorBadge creator={task.created_by} />
            {isOverdue && (
              <span style={{ fontSize: 10, color: '#fc8181', fontWeight: 600 }}>OVERDUE</span>
            )}
          </div>
          {task.description && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {task.description}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
            <span>{task.task_type}</span>
            {task.schedule_kind !== 'manual' && task.cron_like && (
              <span>{task.cron_like}</span>
            )}
            {task.next_run_at && (
              <span>Next: {formatTime(task.next_run_at)}</span>
            )}
            {task.last_run_at && (
              <span>Last: {formatTime(task.last_run_at)}</span>
            )}
            {task.last_result_status && (
              <span style={{ color: task.last_result_status === 'success' ? '#68d391' : '#fc8181' }}>
                {task.last_result_status}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {task.status !== 'completed' && task.status !== 'canceled' && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {task.status === 'active' && (
              <>
                <button
                  className="agent-settings-panel__history-link"
                  onClick={() => runNowMut.mutate(task.id)}
                  disabled={runNowMut.isPending}
                  style={{ fontSize: 11 }}
                >
                  Run Now
                </button>
                <button
                  className="agent-settings-panel__history-link"
                  onClick={() => pauseMut.mutate(task.id)}
                  disabled={pauseMut.isPending}
                  style={{ fontSize: 11 }}
                >
                  Pause
                </button>
              </>
            )}
            {task.status === 'paused' && (
              <button
                className="agent-settings-panel__history-link"
                onClick={() => resumeMut.mutate(task.id)}
                disabled={resumeMut.isPending}
                style={{ fontSize: 11 }}
              >
                Resume
              </button>
            )}
            <button
              className="agent-settings-panel__history-link"
              onClick={() => completeMut.mutate(task.id)}
              disabled={completeMut.isPending}
              style={{ fontSize: 11, color: '#68d391' }}
            >
              ✓ Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface CreateFormState {
  title: string;
  description: string;
  task_type: string;
  schedule_kind: string;
  cron_like: string;
}

function CreateTaskForm({ potId, onDone }: { potId: string; onDone: () => void }) {
  const createMut = useCreateTask(potId);
  const [form, setForm] = useState<CreateFormState>({
    title: '',
    description: '',
    task_type: 'custom_prompt_task',
    schedule_kind: 'manual',
    cron_like: '',
  });
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setError('');
    try {
      await createMut.mutateAsync({
        title: form.title,
        description: form.description || undefined,
        task_type: form.task_type,
        schedule_kind: form.schedule_kind,
        cron_like: form.cron_like || undefined,
      } as any);
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create task');
    }
  };

  return (
    <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>New Task</div>
      <input
        className="agent-settings-panel__input"
        placeholder="Task title*"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <input
        className="agent-settings-panel__input"
        placeholder="Description (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <select
          className="agent-settings-panel__input"
          value={form.task_type}
          onChange={(e) => setForm({ ...form, task_type: e.target.value })}
          style={{ flex: 1 }}
        >
          <option value="custom_prompt_task">Custom Prompt</option>
          <option value="heartbeat">Heartbeat</option>
          <option value="deep_research_run">Deep Research</option>
          <option value="journal_daily">Daily Journal</option>
        </select>
        <select
          className="agent-settings-panel__input"
          value={form.schedule_kind}
          onChange={(e) => setForm({ ...form, schedule_kind: e.target.value })}
          style={{ flex: 1 }}
        >
          <option value="manual">Manual</option>
          <option value="cron">Recurring</option>
          <option value="once">One-time</option>
        </select>
      </div>
      {form.schedule_kind === 'cron' && (
        <input
          className="agent-settings-panel__input"
          placeholder='e.g. "daily at 09:00" or "weekly on MON at 08:00"'
          value={form.cron_like}
          onChange={(e) => setForm({ ...form, cron_like: e.target.value })}
        />
      )}
      {error && <div className="agent-settings-panel__error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="agent-settings-panel__save-btn"
          onClick={handleSubmit}
          disabled={createMut.isPending}
          style={{ fontSize: 12 }}
        >
          {createMut.isPending ? 'Creating…' : 'Create Task'}
        </button>
        <button className="agent-settings-panel__history-link" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function TasksPanel({ potId }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  const { data, isLoading } = usePotTasks(potId, {
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit: 100,
  });
  const seedMut = useSeedTasks(potId);

  const tasks = data?.tasks ?? [];

  const handleSeed = async () => {
    setSeedMsg('');
    try {
      const result = await seedMut.mutateAsync();
      if (result.created.length > 0) {
        setSeedMsg(`Created ${result.created.length} starter task${result.created.length !== 1 ? 's' : ''}.`);
      } else {
        setSeedMsg('Starter tasks already exist.');
      }
    } catch {
      setSeedMsg('Failed to create starter tasks.');
    }
  };

  return (
    <div className="agent-settings-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="agent-settings-panel__heading" style={{ marginBottom: 0 }}>Tasks</div>
        <button
          className="agent-settings-panel__run-btn"
          onClick={() => setShowCreate(true)}
          style={{ fontSize: 12 }}
        >
          + New Task
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['active', 'paused', 'completed', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 12,
              background: statusFilter === s ? 'var(--gold)' : 'var(--bg-secondary)',
              color: statusFilter === s ? '#1a1a1a' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {s}
          </button>
        ))}
        {data?.total !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {data.total} total
          </span>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ marginBottom: 14 }}>
          <CreateTaskForm potId={potId} onDone={() => setShowCreate(false)} />
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: '16px 0' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: statusFilter === 'active' ? 14 : 0 }}>
            No {statusFilter === 'all' ? '' : statusFilter} tasks.
          </div>
          {statusFilter === 'active' && (
            <div>
              <button
                className="agent-settings-panel__save-btn"
                onClick={handleSeed}
                disabled={seedMut.isPending}
                style={{ fontSize: 12, marginBottom: 8 }}
              >
                {seedMut.isPending ? 'Setting up…' : 'Set up starter tasks'}
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Creates a daily heartbeat, daily journal, and weekly deep research on a default schedule.
              </div>
              {seedMsg && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{seedMsg}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} potId={potId} />
          ))}
        </div>
      )}
    </div>
  );
}
