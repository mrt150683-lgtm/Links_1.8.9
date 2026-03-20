/**
 * AgentSettingsPanel
 *
 * Settings section added inside PotSettingsTab.
 * Contains: opt-in toggle, autonomy mode, goal text,
 * delivery time, quiet hours, tool building options.
 */

import { useState, useEffect } from 'react';
import { useAgentConfig, useUpsertAgentConfig, useTriggerAgentRun } from './useAgent';
import './agent.css';

interface Props {
  potId: string;
  onViewHistory?: () => void;
  onViewTools?: () => void;
}

export function AgentSettingsPanel({ potId, onViewHistory, onViewTools }: Props) {
  const { data: config, isLoading } = useAgentConfig(potId);
  const upsertMut = useUpsertAgentConfig(potId);
  const triggerMut = useTriggerAgentRun(potId);

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'quiet' | 'balanced' | 'bold'>('balanced');
  const [goalText, setGoalText] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('08:00');
  const [allowToolBuilding, setAllowToolBuilding] = useState(false);
  const [allowAutoTest, setAllowAutoTest] = useState(false);
  const [allowAutoRun, setAllowAutoRun] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setMode(config.mode);
      setGoalText(config.goal_text ?? '');
      setDeliveryTime(config.delivery_time_local ?? '08:00');
      setAllowToolBuilding(config.allow_tool_building);
      setAllowAutoTest(config.allow_auto_test_low_risk_tools);
      setAllowAutoRun(config.allow_auto_run_low_risk_tools);
    }
  }, [config]);

  const handleSave = async () => {
    setError('');
    try {
      await upsertMut.mutateAsync({
        enabled,
        mode,
        goal_text: goalText || null,
        delivery_time_local: deliveryTime,
        allow_tool_building: allowToolBuilding,
        allow_auto_test_low_risk_tools: allowAutoTest,
        allow_auto_run_low_risk_tools: allowAutoRun,
      } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    }
  };

  const handleRunNow = async () => {
    try {
      await triggerMut.mutateAsync();
    } catch {
      // ignore — run still started
    }
  };

  if (isLoading) return null;

  return (
    <div className="agent-settings-panel">
      <div className="agent-settings-panel__heading">Autonomous Agent</div>

      {/* Enable toggle */}
      <div className="agent-settings-panel__enable-row">
        <span className="agent-settings-panel__enable-label">Enable agent for this pot</span>
        <label className="agent-settings-panel__toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="agent-settings-panel__toggle-slider" />
        </label>
      </div>

      {enabled && (
        <div className="agent-settings-panel__body">
          {/* Autonomy mode */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Autonomy Mode</span>
            <p className="agent-settings-panel__hint">
              Quiet: manual only. Balanced: auto-test, approval required. Bold: auto-test + auto-run
              approved tools.
            </p>
            <div className="agent-settings-panel__mode-buttons">
              {(['quiet', 'balanced', 'bold'] as const).map((m) => (
                <button
                  key={m}
                  className={`agent-settings-panel__mode-btn${mode === m ? ' agent-settings-panel__mode-btn--selected' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Goal text */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Agent Goal</span>
            <p className="agent-settings-panel__hint">
              What should the agent focus on? Leave blank for general insight surfacing.
            </p>
            <textarea
              className="agent-settings-panel__textarea"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              placeholder="e.g. Find contradictions in my research notes…"
              rows={3}
            />
          </div>

          {/* Delivery time */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Delivery Time</span>
            <p className="agent-settings-panel__hint">
              Local time for daily surprise delivery (HH:MM).
            </p>
            <input
              className="agent-settings-panel__input"
              type="time"
              value={deliveryTime}
              onChange={(e) => setDeliveryTime(e.target.value)}
            />
          </div>

          {/* Tool building */}
          <div className="agent-settings-panel__section">
            <span className="agent-settings-panel__label">Tool Building</span>
            <p className="agent-settings-panel__hint">
              Allow the agent to generate and propose new tools based on detected workflow patterns.
            </p>
            <label className="agent-settings-panel__check-row">
              <input
                type="checkbox"
                checked={allowToolBuilding}
                onChange={(e) => setAllowToolBuilding(e.target.checked)}
              />
              <span>Enable tool building</span>
            </label>
            {allowToolBuilding && (
              <>
                <label className="agent-settings-panel__check-row">
                  <input
                    type="checkbox"
                    checked={allowAutoTest}
                    onChange={(e) => setAllowAutoTest(e.target.checked)}
                  />
                  <span>Auto-test low-risk tools</span>
                </label>
                {mode === 'bold' && (
                  <label className="agent-settings-panel__check-row">
                    <input
                      type="checkbox"
                      checked={allowAutoRun}
                      onChange={(e) => setAllowAutoRun(e.target.checked)}
                    />
                    <span>Auto-run approved low-risk tools (Bold mode only)</span>
                  </label>
                )}
              </>
            )}
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
          {upsertMut.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Agent Settings'}
        </button>
        {config?.enabled && (
          <button
            className="agent-settings-panel__run-btn"
            onClick={handleRunNow}
            disabled={triggerMut.isPending}
          >
            {triggerMut.isPending ? 'Starting…' : 'Run Now'}
          </button>
        )}
        {onViewHistory && (
          <button className="agent-settings-panel__history-link" onClick={onViewHistory}>
            View Run History
          </button>
        )}
        {onViewTools && config?.allow_tool_building && (
          <button className="agent-settings-panel__history-link" onClick={onViewTools}>
            View Tools
          </button>
        )}
      </div>
    </div>
  );
}
