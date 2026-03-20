/**
 * AutomationSettingsPanel
 *
 * Per-pot automation settings: heartbeat, agent task management,
 * model picker, timezone, permission gates.
 */

import { useState, useEffect } from 'react';
import { useAutomationSettings, useUpsertAutomationSettings, useRunHeartbeat, useSeedTasks } from './useAutomation';

interface Props {
  potId: string;
  onViewHeartbeat?: () => void;
  onViewTasks?: () => void;
}

export function AutomationSettingsPanel({ potId, onViewHeartbeat, onViewTasks }: Props) {
  const { data: settings, isLoading } = useAutomationSettings(potId);
  const upsertMut = useUpsertAutomationSettings(potId);
  const heartbeatMut = useRunHeartbeat(potId);
  const seedMut = useSeedTasks(potId);

  const [enabled, setEnabled] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(false);
  const [agentTaskMgmt, setAgentTaskMgmt] = useState(false);
  const [canCreateTasks, setCanCreateTasks] = useState(false);
  const [canUpdateTasks, setCanUpdateTasks] = useState(false);
  const [canCompleteTasks, setCanCompleteTasks] = useState(false);
  const [proactiveConversations, setProactiveConversations] = useState(false);
  const [proactiveModel, setProactiveModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [timezone, setTimezone] = useState('');
  const [maxTasksPerDay, setMaxTasksPerDay] = useState(5);
  const [maxHeartbeatPerDay, setMaxHeartbeatPerDay] = useState(3);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [seedMsg, setSeedMsg] = useState('');

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setHeartbeatEnabled(settings.heartbeat_enabled);
      setAgentTaskMgmt(settings.agent_task_management_enabled);
      setCanCreateTasks(settings.agent_can_create_tasks);
      setCanUpdateTasks(settings.agent_can_update_tasks);
      setCanCompleteTasks(settings.agent_can_complete_tasks);
      setProactiveConversations(settings.proactive_conversations_enabled ?? false);
      setProactiveModel(settings.proactive_conversation_model ?? '');
      setDefaultModel(settings.default_model ?? '');
      setTimezone(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setMaxTasksPerDay(settings.max_tasks_created_per_day);
      setMaxHeartbeatPerDay(settings.max_heartbeat_runs_per_day);
    }
  }, [settings]);

  const handleSave = async () => {
    setError('');
    try {
      await upsertMut.mutateAsync({
        enabled,
        heartbeat_enabled: heartbeatEnabled,
        agent_task_management_enabled: agentTaskMgmt,
        agent_can_create_tasks: canCreateTasks,
        agent_can_update_tasks: canUpdateTasks,
        agent_can_complete_tasks: canCompleteTasks,
        proactive_conversations_enabled: proactiveConversations,
        proactive_conversation_model: proactiveModel || null,
        default_model: defaultModel || null,
        timezone: timezone || null,
        max_tasks_created_per_day: maxTasksPerDay,
        max_heartbeat_runs_per_day: maxHeartbeatPerDay,
      } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    }
  };

  const handleRunHeartbeat = async () => {
    try {
      await heartbeatMut.mutateAsync();
    } catch {
      // ignore
    }
  };

  const handleSeedTasks = async () => {
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

  if (isLoading) return null;

  return (
    <div className="agent-settings-panel">
      <div className="agent-settings-panel__heading">Automation & Heartbeat</div>

      {/* Enable toggle */}
      <div className="agent-settings-panel__enable-row">
        <span className="agent-settings-panel__enable-label">Enable automation for this pot</span>
        <label className="agent-settings-panel__toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="agent-settings-panel__toggle-slider" />
        </label>
      </div>

      {enabled && (
        <div className="agent-settings-panel__body">
          {/* Heartbeat */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Heartbeat</span>
            <p className="agent-settings-panel__hint">
              Generates periodic AI-powered project status reports with open loops, risks, and recommendations.
            </p>
            <label className="agent-settings-panel__check-row">
              <input
                type="checkbox"
                checked={heartbeatEnabled}
                onChange={(e) => setHeartbeatEnabled(e.target.checked)}
              />
              <span>Enable heartbeat reports</span>
            </label>
            {heartbeatEnabled && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="agent-settings-panel__run-btn"
                  onClick={handleRunHeartbeat}
                  disabled={heartbeatMut.isPending}
                  style={{ fontSize: 12 }}
                >
                  {heartbeatMut.isPending ? 'Starting…' : 'Run Heartbeat Now'}
                </button>
                {onViewHeartbeat && (
                  <button className="agent-settings-panel__history-link" onClick={onViewHeartbeat}>
                    View Heartbeat
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Proactive conversations */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Proactive Conversations</span>
            <p className="agent-settings-panel__hint">
              Agent randomly starts conversations about your research (1–2 times per day). It will create a new chat thread with an opening message already waiting for you.
            </p>
            <label className="agent-settings-panel__check-row">
              <input
                type="checkbox"
                checked={proactiveConversations}
                onChange={(e) => setProactiveConversations(e.target.checked)}
              />
              <span>Enable proactive conversations</span>
            </label>
            {proactiveConversations && (
              <div style={{ marginTop: 8 }}>
                <span className="agent-settings-panel__label" style={{ fontSize: 12 }}>
                  Model (optional)
                </span>
                <input
                  className="agent-settings-panel__input"
                  type="text"
                  value={proactiveModel}
                  onChange={(e) => setProactiveModel(e.target.value)}
                  placeholder="e.g. x-ai/grok-4.1-fast"
                />
              </div>
            )}
          </div>

          {/* Agent task management */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Agent Task Management</span>
            <p className="agent-settings-panel__hint">
              Allow the heartbeat AI to propose and manage tasks. Explicit permission flags below control exactly
              what the agent is allowed to do.
            </p>
            <label className="agent-settings-panel__check-row">
              <input
                type="checkbox"
                checked={agentTaskMgmt}
                onChange={(e) => setAgentTaskMgmt(e.target.checked)}
              />
              <span>Enable agent task management</span>
            </label>

            {agentTaskMgmt && (
              <div style={{ marginTop: 8, paddingLeft: 20 }}>
                <label className="agent-settings-panel__check-row">
                  <input
                    type="checkbox"
                    checked={canCreateTasks}
                    onChange={(e) => setCanCreateTasks(e.target.checked)}
                  />
                  <span>Agent can create tasks</span>
                </label>
                <label className="agent-settings-panel__check-row">
                  <input
                    type="checkbox"
                    checked={canUpdateTasks}
                    onChange={(e) => setCanUpdateTasks(e.target.checked)}
                  />
                  <span>Agent can pause tasks</span>
                </label>
                <label className="agent-settings-panel__check-row">
                  <input
                    type="checkbox"
                    checked={canCompleteTasks}
                    onChange={(e) => setCanCompleteTasks(e.target.checked)}
                  />
                  <span>Agent can complete tasks</span>
                </label>
              </div>
            )}

            {onViewTasks && (
              <button
                className="agent-settings-panel__history-link"
                onClick={onViewTasks}
                style={{ marginTop: 8 }}
              >
                View Tasks
              </button>
            )}
          </div>

          {/* Rate limits */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Rate Limits</span>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Max tasks created / day</span>
                <input
                  className="agent-settings-panel__input"
                  type="number"
                  min={0}
                  max={50}
                  value={maxTasksPerDay}
                  onChange={(e) => setMaxTasksPerDay(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  style={{ width: 80 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Max heartbeat runs / day</span>
                <input
                  className="agent-settings-panel__input"
                  type="number"
                  min={1}
                  max={24}
                  value={maxHeartbeatPerDay}
                  onChange={(e) => setMaxHeartbeatPerDay(Math.max(1, parseInt(e.target.value, 10) || 3))}
                  style={{ width: 80 }}
                />
              </label>
            </div>
          </div>

          {/* Model */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Heartbeat Model (optional)</span>
            <p className="agent-settings-panel__hint">
              Override the default heartbeat model for this pot. Leave blank to use the global default.
            </p>
            <input
              className="agent-settings-panel__input"
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="e.g. x-ai/grok-4.1-fast"
            />
          </div>

          {/* Timezone */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Timezone</span>
            <input
              className="agent-settings-panel__input"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. America/New_York"
            />
          </div>

          {error && <div className="agent-settings-panel__error">{error}</div>}
        </div>
      )}

      <div className="agent-settings-panel__actions">
        <button
          className="agent-settings-panel__save-btn"
          onClick={handleSave}
          disabled={upsertMut.isPending}
        >
          {upsertMut.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Automation Settings'}
        </button>
        <button
          className="agent-settings-panel__history-link"
          onClick={handleSeedTasks}
          disabled={seedMut.isPending}
          style={{ fontSize: 12, marginTop: 10 }}
          title="Creates a daily heartbeat, daily journal, and weekly deep research on a default schedule"
        >
          {seedMut.isPending ? 'Setting up…' : 'Set up starter tasks'}
        </button>
        {seedMsg && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{seedMsg}</div>
        )}
      </div>
    </div>
  );
}
