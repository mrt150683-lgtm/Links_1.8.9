/**
 * VoicePanel — Phase G (Dev/Test UI)
 *
 * Floating panel shown during an active voice session.
 * Displays: current phase, last transcript, last response,
 * and a stop button. Keeps out of the way of the main UI.
 */

import type { VoiceControllerState } from './useVoiceController.js';

interface VoicePanelProps {
  state: VoiceControllerState;
  onStop: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  detected: 'Detected…',
  processing: 'Processing…',
  speaking: 'Speaking…',
  error: 'Error',
};

const PHASE_COLORS: Record<string, string> = {
  idle: '#888',
  listening: '#3ecf8e',
  detected: '#f0a500',
  processing: '#6e8efb',
  speaking: '#e05252',
  error: '#e05252',
};

export function VoicePanel({ state, onStop }: VoicePanelProps) {
  const phaseColor = PHASE_COLORS[state.phase] ?? '#888';
  const phaseLabel = PHASE_LABELS[state.phase] ?? state.phase;

  return (
    <div className="voice-panel">
      <div className="voice-panel__header">
        <span
          className="voice-panel__dot"
          style={{ background: phaseColor }}
          title={phaseLabel}
        />
        <span className="voice-panel__phase">{phaseLabel}</span>
        <button className="voice-panel__stop" onClick={onStop} title="Stop voice session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
      </div>

      {state.transcript && (
        <div className="voice-panel__row">
          <span className="voice-panel__label">You</span>
          <span className="voice-panel__text">{state.transcript}</span>
        </div>
      )}

      {state.response && (
        <div className="voice-panel__row">
          <span className="voice-panel__label">AI</span>
          <span className="voice-panel__text voice-panel__text--response">
            {state.response.length > 200 ? state.response.slice(0, 200) + '…' : state.response}
          </span>
        </div>
      )}

      {state.error && (
        <div className="voice-panel__row">
          <span className="voice-panel__label voice-panel__label--err">Error</span>
          <span className="voice-panel__text voice-panel__text--err">{state.error}</span>
        </div>
      )}
    </div>
  );
}
