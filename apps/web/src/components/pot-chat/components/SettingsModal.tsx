import React, { useState, useEffect, useRef } from 'react';
import type { ModelInfo, PotChatSettings } from '../potChatTypes';

interface VoiceOption {
  id: string;
  display_name: string;
  lang_code: string;
  enabled: boolean;
}

export interface MomModels {
  planner: string;
  specialist: string;
  merge: string;
}

interface ToggleProps {
  checked: boolean;
  onChange(val: boolean): void;
  label: string;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => (
  <label className="pot-chat__toggle-row">
    <span className="pot-chat__toggle-label">{label}</span>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`pot-chat__toggle-switch ${checked ? 'pot-chat__toggle-switch--on' : ''}`}
    >
      <div className="pot-chat__toggle-knob" />
    </button>
  </label>
);

interface SettingsModalProps {
  settings: PotChatSettings;
  models: ModelInfo[];
  selectedModelId: string;
  momModels: MomModels;
  onClose(): void;
  onSettingsChange(settings: PotChatSettings): void;
  onSelectedModelIdChange(id: string): void;
  onMomModelsChange(models: MomModels): void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  models,
  selectedModelId,
  momModels,
  onClose,
  onSettingsChange,
  onSelectedModelIdChange,
  onMomModelsChange,
}) => {
  const set = <K extends keyof PotChatSettings>(key: K, val: PotChatSettings[K]) =>
    onSettingsChange({ ...settings, [key]: val });

  // ── Voice settings state ──────────────────────────────────────────────────
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/voice/voices').then((r) => r.json()),
      fetch('/api/voice/settings').then((r) => r.json()),
    ])
      .then(([voicesData, settingsData]) => {
        setVoices((voicesData.voices ?? []).filter((v: VoiceOption) => v.enabled));
        setSelectedVoiceId(settingsData.settings?.selected_voice_id ?? '');
      })
      .catch(() => {});
  }, []);

  const handleVoiceSelect = async (id: string) => {
    setSelectedVoiceId(id);
    await fetch('/api/voice/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_voice_id: id }),
    }).catch(() => {});
  };

  const handleImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setIsImporting(true);
    try {
      const form = new FormData();
      form.append('voice_file', file);
      const res = await fetch('/api/voice/voices/import', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.voice) {
        setVoices((prev) => [...prev.filter((v) => v.id !== data.voice.id), data.voice]);
        await handleVoiceSelect(data.voice.id);
      } else {
        setImportError(data.message ?? 'Import failed');
      }
    } catch {
      setImportError('Import failed — check server logs');
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  // Group voices by language for the select
  const voicesByLang: Record<string, VoiceOption[]> = {};
  for (const v of voices) {
    (voicesByLang[v.lang_code] ??= []).push(v);
  }

  return (
    <div className="pot-chat__modal-backdrop">
      <div className="pot-chat__modal pot-chat__modal--sm" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pot-chat__modal-header">
          <h2 className="pot-chat__modal-title">Chat Settings</h2>
          <button onClick={onClose} className="pot-chat__modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="pot-chat__modal-body" style={{ padding: 'var(--space-4)' }}>
          {/* Model selection */}
          <div className="pot-chat__settings-section">
            <label className="pot-chat__settings-label">AI Model</label>
            <select
              value={selectedModelId}
              onChange={(e) => onSelectedModelIdChange(e.target.value)}
              className="pot-chat__settings-select"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({Math.round(m.contextWindowTokens / 1000)}k ctx)
                </option>
              ))}
            </select>
            <p className="pot-chat__settings-hint">Model affects context window and cost.</p>
          </div>

          {/* Replay section */}
          <div className="pot-chat__settings-section">
            <label className="pot-chat__settings-label">Response Playback</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <Toggle
                label="Typewriter effect"
                checked={settings.replayEnabled}
                onChange={(v) => set('replayEnabled', v)}
              />
              {settings.replayEnabled && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="pot-chat__settings-hint" style={{ margin: 0 }}>Speed</span>
                    <span className="pot-chat__settings-hint" style={{ margin: 0 }}>{settings.replaySpeed} wps</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    step={1}
                    value={settings.replaySpeed}
                    onChange={(e) => set('replaySpeed', Number(e.target.value))}
                    className="pot-chat__speed-slider"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="pot-chat__settings-hint" style={{ margin: 0 }}>Slow</span>
                    <span className="pot-chat__settings-hint" style={{ margin: 0 }}>Fast</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* MoM Models */}
          <div className="pot-chat__settings-section">
            <label className="pot-chat__settings-label">MoM Models</label>
            <p className="pot-chat__settings-hint" style={{ marginBottom: 8 }}>
              Models used for Mixture-of-Models chat (Lite / Standard / Heavy).
            </p>
            {(['planner', 'specialist', 'merge'] as const).map((role) => (
              <div key={role} style={{ marginBottom: 8 }}>
                <div className="pot-chat__settings-hint" style={{ margin: '0 0 4px', textTransform: 'capitalize' }}>{role}</div>
                <select
                  value={momModels[role]}
                  onChange={(e) => onMomModelsChange({ ...momModels, [role]: e.target.value })}
                  className="pot-chat__settings-select"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Toggles */}
          <div className="pot-chat__settings-section">
            <label className="pot-chat__settings-label">Display</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <Toggle
                label="Metadata-only by default"
                checked={settings.metadataOnlyByDefault}
                onChange={(v) => set('metadataOnlyByDefault', v)}
              />
              <Toggle
                label="Auto-save chat as entry"
                checked={settings.autoSaveChatAsEntry}
                onChange={(v) => set('autoSaveChatAsEntry', v)}
              />
              <Toggle
                label="Show source snippets"
                checked={settings.showSourceSnippets}
                onChange={(v) => set('showSourceSnippets', v)}
              />
              <Toggle
                label="Compact mode"
                checked={settings.compactMode}
                onChange={(v) => set('compactMode', v)}
              />
            </div>
          </div>

          {/* Voice settings */}
          <div className="pot-chat__settings-section">
            <label className="pot-chat__settings-label">Voice</label>
            <p className="pot-chat__settings-hint" style={{ marginBottom: 8 }}>
              Select the Piper TTS voice for voice mode. Voices are .onnx model files.
            </p>

            {voices.length === 0 ? (
              <p className="pot-chat__settings-hint">No voices found. Import a .onnx voice file below.</p>
            ) : (
              <select
                value={selectedVoiceId}
                onChange={(e) => handleVoiceSelect(e.target.value)}
                className="pot-chat__settings-select"
              >
                <option value="">— Web Speech API fallback —</option>
                {Object.entries(voicesByLang).sort().map(([lang, langVoices]) => (
                  <optgroup key={lang} label={lang}>
                    {langVoices.map((v) => (
                      <option key={v.id} value={v.id}>{v.display_name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="pot-chat__settings-hint"
                style={{
                  cursor: 'pointer',
                  padding: '4px 10px',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: 'var(--color-text)',
                  fontSize: 12,
                }}
                onClick={() => importRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? 'Importing…' : '+ Import .onnx'}
              </button>
              <span className="pot-chat__settings-hint" style={{ margin: 0, fontSize: 11 }}>
                Filename: lang-speaker-quality.onnx
              </span>
            </div>
            <input
              ref={importRef}
              type="file"
              accept=".onnx"
              style={{ display: 'none' }}
              onChange={handleImportChange}
            />
            {importError && (
              <p style={{ color: 'var(--color-error, #e05252)', fontSize: 12, marginTop: 6 }}>{importError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
