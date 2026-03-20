import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import aiIcon from '@/assets/icons/AI.png?url';
import jobsIcon from '@/assets/icons/Jobs.png?url';
import journalIcon from '@/assets/icons/generate.png?url';
import securityIcon from '@/assets/icons/security.png?url';
import dataIcon from '@/assets/icons/data.png?url';
import uiIcon from '@/assets/icons/UI_settins.png?url';
import systemIcon from '@/assets/icons/Audit.png?url';
import extensionIcon from '@/assets/icons/inbox.png?url';
import type { ProcessingConfig, LoggingPreferences } from '@/lib/types';
import './Settings.css';

interface AiSettings {
  default_model?: string;
  task_models?: {
    tagging?: string;
    linking?: string;
    summarization?: string;
    entity_extraction?: string;
    image_tagging?: string;
    video_transcription?: string;
    audio_transcription?: string;
    deep_research?: string;
    chat?: string;
  };
  nutrition_models?: {
    meal_image_analysis?: string;
    daily_review?: string;
    weekly_review?: string;
    recipe_generation?: string;
    craving_assistant?: string;
  };
  chat_personality_prompt?: string;
  temperature?: number;
  max_tokens?: number;
}

interface ModelInfo {
  id: number;
  name: string;
  context_length: number;
  pricing_prompt: number | null;
  pricing_completion: number | null;
  supports_vision: number;
  supports_tools: number;
  architecture: string | null;
  modalities: string | null;
  fetched_at: number;
}

interface ModelsResponse {
  models: ModelInfo[];
  cache: {
    last_fetch: number | null;
    count: number;
  };
}

interface IdleProcessingPrefs {
  enabled: boolean;
  idle_only: boolean;
  run_window_start?: string;
  run_window_end?: string;
  pot_ids?: string[];
}

interface Pot {
  id: string;
  name: string;
  icon_emoji?: string;
}

interface AutomationPrefs {
  enabled?: boolean;
  default_model?: string;
  timezone?: string;
  max_heartbeat_runs_per_day?: number;
  max_tasks_created_per_day?: number;
  proactive_main_chat_enabled?: boolean;
  proactive_main_chat_model?: string;
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string>('ai-provider');


  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <h1>Settings</h1>
      </div>

      <div className="settings-page__layout">
        <nav className="settings-nav">
          <button
            className={`settings-nav__item ${activeSection === 'ai-provider' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('ai-provider')}
          >
            <img src={aiIcon} alt="AI" className="settings-nav__icon-img" />
            AI Provider
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'idle-processing' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('idle-processing')}
          >
            <img src={jobsIcon} alt="Idle Processing" className="settings-nav__icon-img" />
            Idle Processing
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'journal' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('journal')}
          >
            <img src={journalIcon} alt="Journal" className="settings-nav__icon-img" />
            Journal
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'deep-research' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('deep-research')}
          >
            <img src={aiIcon} alt="Deep Research" className="settings-nav__icon-img" />
            Deep Research
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'security' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('security')}
            disabled
          >
            <img src={securityIcon} alt="Security" className="settings-nav__icon-img" />
            Security
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'data' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('data')}
            disabled
          >
            <img src={dataIcon} alt="Data" className="settings-nav__icon-img" />
            Data & Storage
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'ui' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('ui')}
            disabled
          >
            <img src={uiIcon} alt="UI" className="settings-nav__icon-img" />
            UI Preferences
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'system' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('system')}
          >
            <img src={systemIcon} alt="System" className="settings-nav__icon-img" />
            System
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'extension' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('extension')}
          >
            <img src={extensionIcon} alt="Extension" className="settings-nav__icon-img" />
            Extension
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'nutrition' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('nutrition')}
          >
            <img src={journalIcon} alt="Nutrition" className="settings-nav__icon-img" />
            Nutrition
          </button>
          <button
            className={`settings-nav__item ${activeSection === 'automation' ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveSection('automation')}
          >
            <img src={jobsIcon} alt="Automation" className="settings-nav__icon-img" />
            Automation
          </button>
        </nav>

        <div className="settings-content">
          {activeSection === 'ai-provider' && <AiProviderSection />}
          {activeSection === 'idle-processing' && <IdleProcessingSection />}
          {activeSection === 'journal' && <JournalSection />}
          {activeSection === 'deep-research' && <DeepResearchSection />}
          {activeSection === 'system' && <SystemSection />}
          {activeSection === 'extension' && <ExtensionSection />}
          {activeSection === 'nutrition' && <NutritionSection />}
          {activeSection === 'automation' && <AutomationSection />}
        </div>
      </div>
    </div>
  );
}

// Fallback models used by the worker when no user preference is set.
// These must stay in sync with the actual defaults in apps/worker/src/jobs/*.ts
const TASK_MODEL_DEFAULTS = {
  tagging: 'x-ai/grok-4.1-fast',
  summarization: 'x-ai/grok-4.1-fast',
  linking: 'x-ai/grok-4.1-fast',
  entity_extraction: 'x-ai/grok-4.1-fast',
  chat: 'x-ai/grok-4.1-fast',
  deep_research: 'x-ai/grok-4.1-fast',
  image_tagging: 'google/gemini-2.5-flash',
  audio_transcription: 'openai/gpt-4o-audio-preview',
  // video_transcription has no fallback — requires explicit config
} as const;

function AiProviderSection() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api.get<AiSettings>('/prefs/ai').catch((): AiSettings => ({ temperature: 0.2, max_tokens: 4000 })),
  });

  // OpenRouter API key state
  const { data: keyStatus, refetch: refetchKeyStatus } = useQuery({
    queryKey: ['openrouter-key-status'],
    queryFn: () => api.get<{ configured: boolean; hint: string | null; source: string | null }>('/prefs/openrouter-key'),
  });
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const saveApiKey = useMutation({
    mutationFn: (api_key: string) => api.put('/prefs/openrouter-key', { api_key }),
    onSuccess: () => {
      setApiKeyDraft('');
      setKeyMessage({ type: 'success', text: 'API key saved. AI features are now available.' });
      refetchKeyStatus();
    },
    onError: () => {
      setKeyMessage({ type: 'error', text: 'Failed to save API key. Please try again.' });
    },
  });

  // Local draft for personality prompt — only saves on blur to avoid per-keystroke API calls
  const [personalityDraft, setPersonalityDraft] = useState('');
  const [personalityInitialized, setPersonalityInitialized] = useState(false);
  useEffect(() => {
    if (settings && !personalityInitialized) {
      setPersonalityDraft(settings.chat_personality_prompt || '');
      setPersonalityInitialized(true);
    }
  }, [settings, personalityInitialized]);

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AiSettings>) => api.put<AiSettings>('/prefs/ai', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });

  const handleModelChange = (task: string, value: string) => {
    updateSettings.mutate({
      task_models: {
        ...settings?.task_models,
        [task]: value || undefined,
      },
    });
  };

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<ModelsResponse>('/models').catch(() => ({ models: [], cache: { last_fetch: null, count: 0 } })),
  });

  const models = modelsData?.models ?? [];

  const { data: visionModelsData } = useQuery({
    queryKey: ['vision-models'],
    queryFn: () => api.get<{ models: ModelInfo[]; count: number }>('/models/vision').catch(() => ({ models: [], count: 0 })),
  });

  const visionModels = visionModelsData?.models ?? [];

  const refreshModels = useMutation({
    mutationFn: () => api.post('/models/refresh', { trigger: 'manual' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
    },
  });

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>AI Provider (OpenRouter)</h2>
        <p className="text-muted">
          Configure your OpenRouter API key for AI-powered features (tagging, summarization, link discovery).
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">API Key</h3>

        {keyStatus?.configured ? (
          <div className="settings-message settings-message--success" style={{ marginBottom: '12px' }}>
            Key configured: <code>{keyStatus.hint}</code>
            {keyStatus.source === 'env' && <span className="text-muted"> (from environment)</span>}
          </div>
        ) : (
          <div className="settings-message settings-message--warning" style={{ marginBottom: '12px' }}>
            No API key configured. AI features (chat, tagging, summarization) will not work until a key is set.
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <input
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-or-v1-..."
            value={apiKeyDraft}
            onChange={(e) => { setApiKeyDraft(e.target.value); setKeyMessage(null); }}
            className="api-key-input-field"
            style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }}
          />
          <button
            className="btn-secondary"
            style={{ padding: '6px 10px', fontSize: '12px' }}
            onClick={() => setShowApiKey((v) => !v)}
            title={showApiKey ? 'Hide key' : 'Show key'}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
          <button
            className="btn-primary"
            style={{ padding: '6px 14px', fontSize: '13px' }}
            disabled={!apiKeyDraft.trim() || saveApiKey.isPending}
            onClick={() => saveApiKey.mutate(apiKeyDraft.trim())}
          >
            {saveApiKey.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {keyMessage && (
          <p style={{ fontSize: '12px', color: keyMessage.type === 'success' ? 'var(--green-1, #4caf50)' : 'var(--red-1, #f44336)', margin: '4px 0 0' }}>
            {keyMessage.text}
          </p>
        )}

        <p className="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
          Get your free API key at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            openrouter.ai/keys
          </a>
          . Keys stored here override the <code>.env</code> file and take effect immediately.
        </p>

        {keyStatus?.configured && (
          <button
            className="btn-secondary"
            style={{ marginTop: '8px', fontSize: '12px', padding: '4px 10px' }}
            onClick={() => { setApiKeyDraft(''); saveApiKey.mutate(''); }}
          >
            Clear stored key
          </button>
        )}
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Available Models</h3>

        <div className="models-header">
          <p className="text-muted">
            {models.length > 0
              ? `${models.length} models cached${modelsData?.cache.last_fetch ? ` (fetched ${new Date(modelsData.cache.last_fetch).toLocaleString()})` : ''}`
              : 'No models loaded yet. Click Refresh to fetch from OpenRouter.'}
          </p>
          <button
            className="btn-secondary"
            onClick={() => refreshModels.mutate()}
            disabled={refreshModels.isPending}
          >
            {refreshModels.isPending ? 'Refreshing...' : 'Refresh Models'}
          </button>
        </div>

        {models.length > 0 && (
          <div className="models-list">
            {models.slice(0, 10).map((model) => (
              <div key={model.name} className="model-item">
                <div className="model-item__name">{model.name}</div>
                <div className="model-item__meta">
                  <span className="badge">{model.context_length.toLocaleString()} ctx</span>
                  {model.supports_vision ? <span className="badge badge--gold">vision</span> : null}
                  {model.pricing_prompt != null && (
                    <span className="text-muted">
                      ${(model.pricing_prompt * 1_000_000).toFixed(2)}/1M prompt
                    </span>
                  )}
                </div>
              </div>
            ))}
            {models.length > 10 && (
              <p className="text-muted">+ {models.length - 10} more models...</p>
            )}
          </div>
        )}
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Model Selection</h3>
        <p className="text-muted">Choose which models to use for each task type.</p>

        <div className="form-field">
          <label>Tagging Model</label>
          <select
            value={settings?.task_models?.tagging || ''}
            onChange={(e) => handleModelChange('tagging', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.tagging})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Summarization Model</label>
          <select
            value={settings?.task_models?.summarization || ''}
            onChange={(e) => handleModelChange('summarization', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.summarization})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Linking Model</label>
          <select
            value={settings?.task_models?.linking || ''}
            onChange={(e) => handleModelChange('linking', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.linking})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Image Tagging Model</label>
          <select
            value={settings?.task_models?.image_tagging || ''}
            onChange={(e) => handleModelChange('image_tagging', e.target.value)}
            disabled={visionModels.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.image_tagging})</option>
            {visionModels.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {visionModels.length === 0 && models.length > 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              No vision-capable models available. Refresh models to load vision models.
            </p>
          )}
          {!settings?.task_models?.image_tagging && visionModels.length > 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              Required for tagging uploaded images. Select a vision model to enable image tagging.
            </p>
          )}
        </div>

        <div className="form-field">
          <label>Video Transcription Model</label>
          <select
            value={settings?.task_models?.video_transcription || ''}
            onChange={(e) => handleModelChange('video_transcription', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Not configured (video transcription disabled)</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {!settings?.task_models?.video_transcription && models.length > 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              Required for transcribing videos from YouTube, Rumble, etc. Select a video-capable model.
            </p>
          )}
        </div>

        <div className="form-field">
          <label>Audio Transcription Model</label>
          <select
            value={settings?.task_models?.audio_transcription || ''}
            onChange={(e) => handleModelChange('audio_transcription', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.audio_transcription})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {!settings?.task_models?.audio_transcription && models.length > 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              Required for transcribing uploaded audio files (MP3, WAV, M4A, etc.). Select a model that supports audio input.
            </p>
          )}
        </div>

        <div className="form-field">
          <label>Chat Model</label>
          <select
            value={settings?.task_models?.chat || ''}
            onChange={(e) => handleModelChange('chat', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.chat})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Chat Personality Prompt</label>
          <textarea
            value={personalityDraft}
            onChange={(e) => setPersonalityDraft(e.target.value)}
            onBlur={() => updateSettings.mutate({ chat_personality_prompt: personalityDraft })}
            rows={4}
            placeholder="Default: The Sentry - calm, evidence-first co-pilot"
            style={{ width: '100%', background: 'var(--bg-0)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-input)', padding: '8px 12px', color: 'var(--text-0)', fontFamily: 'var(--font-ui)', fontSize: '13px', resize: 'vertical' }}
          />
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>Changes save when you click away.</p>
        </div>
      </div>
    </div>
  );
}

function IdleProcessingSection() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ['idle-prefs'],
    queryFn: () => api.get<IdleProcessingPrefs>('/prefs/idle'),
  });

  const { data: potsData } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });

  const pots = potsData?.pots ?? [];

  const updatePrefs = useMutation({
    mutationFn: (patch: Partial<IdleProcessingPrefs>) => api.put<IdleProcessingPrefs>('/prefs/idle', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idle-prefs'] });
    },
  });

  const runNow = useMutation({
    mutationFn: (minutes: number) => api.post('/prefs/idle/run-now', { minutes }),
    onSuccess: () => {
      alert('Worker will run for the specified duration, ignoring idle policy.');
    },
  });

  const [runNowMinutes, setRunNowMinutes] = useState(5);

  const handleToggleEnabled = (enabled: boolean) => {
    updatePrefs.mutate({ enabled });
  };

  const handleToggleIdleOnly = (idle_only: boolean) => {
    updatePrefs.mutate({ idle_only });
  };

  const handleTimeWindowChange = (field: 'run_window_start' | 'run_window_end', value: string) => {
    updatePrefs.mutate({ [field]: value || undefined });
  };

  const handlePotSelection = (potIds: string[]) => {
    updatePrefs.mutate({ pot_ids: potIds.length > 0 ? potIds : undefined });
  };

  const handleRunNow = () => {
    runNow.mutate(runNowMinutes);
  };

  const selectedPots = prefs?.pot_ids ?? [];
  const isAllPots = !prefs?.pot_ids || prefs.pot_ids.length === 0;
  const [showSpecificPots, setShowSpecificPots] = useState(!isAllPots);

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Idle Processing</h2>
        <p className="text-muted">
          Configure when the AI worker processes entries in the background.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Processing Controls</h3>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={prefs?.enabled ?? false}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <span>Enable Idle Processing</span>
          </label>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
            When enabled, the worker will process entries during idle time according to the rules below.
          </p>
        </div>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={prefs?.idle_only ?? false}
              onChange={(e) => handleToggleIdleOnly(e.target.checked)}
              disabled={!prefs?.enabled}
            />
            <span>Only Run When System is Idle</span>
          </label>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
            If checked, the worker will only process when CPU usage is low (future: requires OS idle detection).
          </p>
        </div>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Time Window</h3>
        <p className="text-muted">Restrict processing to a specific time range (24-hour format).</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-field">
            <label>Start Time (HH:MM)</label>
            <input
              type="time"
              value={prefs?.run_window_start || ''}
              onChange={(e) => handleTimeWindowChange('run_window_start', e.target.value)}
              disabled={!prefs?.enabled}
            />
          </div>

          <div className="form-field">
            <label>End Time (HH:MM)</label>
            <input
              type="time"
              value={prefs?.run_window_end || ''}
              onChange={(e) => handleTimeWindowChange('run_window_end', e.target.value)}
              disabled={!prefs?.enabled}
            />
          </div>
        </div>

        {prefs?.run_window_start && prefs?.run_window_end && (
          <p className="text-muted" style={{ marginTop: '8px', fontSize: '12px' }}>
            Processing will only occur between {prefs.run_window_start} and {prefs.run_window_end}.
          </p>
        )}
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Pot Selection</h3>
        <p className="text-muted">Choose which pots the worker should process.</p>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="radio"
              name="pot-selection"
              checked={!showSpecificPots}
              onChange={() => {
                setShowSpecificPots(false);
                handlePotSelection([]);
              }}
              disabled={!prefs?.enabled}
            />
            <span>Process All Pots</span>
          </label>
        </div>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="radio"
              name="pot-selection"
              checked={showSpecificPots}
              onChange={() => {
                setShowSpecificPots(true);
                // Initialize with first pot if none selected
                if (selectedPots.length === 0 && pots.length > 0) {
                  handlePotSelection([pots[0].id]);
                }
              }}
              disabled={!prefs?.enabled}
            />
            <span>Process Specific Pots</span>
          </label>
        </div>

        {showSpecificPots && (
          <div style={{ marginLeft: '24px', marginTop: '12px' }}>
            {pots.map((pot) => (
              <div key={pot.id} className="form-field">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedPots.includes(pot.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handlePotSelection([...selectedPots, pot.id]);
                      } else {
                        handlePotSelection(selectedPots.filter((id) => id !== pot.id));
                      }
                    }}
                    disabled={!prefs?.enabled}
                  />
                  <span>
                    {pot.icon_emoji && <span style={{ marginRight: '8px' }}>{pot.icon_emoji}</span>}
                    {pot.name}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}

        {selectedPots.length === 0 && showSpecificPots && (
          <p className="text-muted" style={{ marginTop: '8px', fontSize: '12px', color: '#ff6b6b' }}>
            No pots selected. Worker will not process any entries.
          </p>
        )}
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Force Run Now</h3>
        <p className="text-muted">
          Temporarily override idle policy and force the worker to run immediately.
        </p>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div className="form-field" style={{ flex: 1 }}>
            <label>Duration (minutes)</label>
            <input
              type="number"
              min="1"
              max="1440"
              value={runNowMinutes}
              onChange={(e) => setRunNowMinutes(parseInt(e.target.value) || 5)}
            />
          </div>

          <button
            className="btn-primary"
            onClick={handleRunNow}
            disabled={runNow.isPending}
            style={{ marginBottom: '8px' }}
          >
            {runNow.isPending ? 'Starting...' : 'Run Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal settings section
// ---------------------------------------------------------------------------

function JournalSection() {
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ['processing-config'],
    queryFn: () => api.get<ProcessingConfig>('/prefs/processing').catch((): ProcessingConfig => ({ journal: { enabled: false } })),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<{ models: ModelInfo[] }>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const patchMutation = useMutation({
    mutationFn: (update: Partial<NonNullable<ProcessingConfig['journal']>>) =>
      api.patch<ProcessingConfig>('/prefs/processing/journal', update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processing-config'] });
    },
  });

  const journal = config?.journal;

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Journal</h2>
        <p className="text-muted">
          Automatically generate daily, weekly, and periodic notes that synthesise captured research.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Enable Journal</h3>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={journal?.enabled ?? false}
              onChange={(e) => patchMutation.mutate({ enabled: e.target.checked })}
            />
            <span>Enable automatic journal generation</span>
          </label>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
            When enabled, the worker will generate a daily note for each day that has captured entries.
            Weekly, monthly, quarterly, and yearly rollups build on top of daily notes.
          </p>
        </div>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Scope</h3>
        <p className="text-muted">Which research pots get journal notes.</p>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={journal?.scopes?.global ?? true}
              disabled={!(journal?.enabled)}
              onChange={(e) => patchMutation.mutate({ scopes: { ...journal?.scopes, global: e.target.checked } })}
            />
            <span>Global (all entries across all pots)</span>
          </label>
        </div>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={journal?.scopes?.pots ?? false}
              disabled={!(journal?.enabled)}
              onChange={(e) => patchMutation.mutate({ scopes: { ...journal?.scopes, pots: e.target.checked } })}
            />
            <span>Per-pot (separate notes for each pot)</span>
          </label>
        </div>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Rollups</h3>
        <p className="text-muted">Which higher-level summaries to generate (each builds on the previous).</p>

        {(['weekly', 'monthly', 'quarterly', 'yearly'] as const).map((kind) => (
          <div className="form-field" key={kind}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={journal?.rollups?.[kind]?.enabled ?? false}
                disabled={!(journal?.enabled)}
                onChange={(e) =>
                  patchMutation.mutate({
                    rollups: { ...journal?.rollups, [kind]: { enabled: e.target.checked } },
                  })
                }
              />
              <span>{kind.charAt(0).toUpperCase() + kind.slice(1)} summaries</span>
            </label>
          </div>
        ))}
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Journaling Model</h3>
        <p className="text-muted">AI model used to write journal notes. Defaults to the provider default.</p>

        <div className="form-field">
          <select
            value={journal?.models?.journaling ?? ''}
            disabled={!(journal?.enabled) || models.length === 0}
            onChange={(e) =>
              patchMutation.mutate({
                models: { journaling: e.target.value || undefined },
              })
            }
          >
            <option value="">Default (x-ai/grok-4.1-fast)</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {models.length === 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              No models loaded. Go to AI Provider → Refresh Models first.
            </p>
          )}
        </div>
      </div>

      {patchMutation.isError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px' }}>Failed to save — check the API connection.</p>
      )}
      {patchMutation.isSuccess && (
        <p style={{ color: 'var(--accent)', fontSize: '13px' }}>Saved.</p>
      )}
    </div>
  );
}

function SystemSection() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ['logging-prefs'],
    queryFn: () => api.get<LoggingPreferences>('/prefs/logging'),
  });

  const updatePrefs = useMutation({
    mutationFn: (patch: Partial<LoggingPreferences>) => api.put<LoggingPreferences>('/prefs/logging', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logging-prefs'] });
    },
  });

  const handleToggleEnabled = (enabled: boolean) => {
    updatePrefs.mutate({ enabled });
  };

  const handleLevelChange = (level: LoggingPreferences['level']) => {
    updatePrefs.mutate({ level });
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>System Settings</h2>
        <p className="text-muted">
          Configure system-level behavior and diagnostics.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Logging</h3>
        <p className="text-muted">Control API and Worker process logging. Changes take effect on next application restart.</p>

        <div className="form-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={prefs?.enabled ?? true}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <span>Enable Logging to File</span>
          </label>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
            When enabled, logs are written to <code>api.log</code> and <code>worker.log</code> in the user data directory.
          </p>
        </div>

        <div className="form-field">
          <label>Log Level</label>
          <select
            value={prefs?.level ?? 'warn'}
            onChange={(e) => handleLevelChange(e.target.value as LoggingPreferences['level'])}
            disabled={prefs?.enabled === false}
          >
            <option value="debug">Debug (Very Verbose)</option>
            <option value="info">Info (Standard)</option>
            <option value="warn">Warning (Minimal)</option>
            <option value="error">Error (Only Failures)</option>
          </select>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
            Choose how much information to record. Higher levels record less data.
          </p>
        </div>

        <div className="settings-message settings-message--info" style={{ marginTop: '16px' }}>
          <strong>Note:</strong> Log files can be found in <code>%APPDATA%\@links\launcher\</code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deep Research settings section
// ---------------------------------------------------------------------------

function DeepResearchSection() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () =>
      api.get<AiSettings>('/prefs/ai').catch((): AiSettings => ({ temperature: 0.2, max_tokens: 4000 })),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<{ models: ModelInfo[] }>('/models').catch(() => ({ models: [] })),
  });

  const models = modelsData?.models ?? [];

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AiSettings>) => api.put<AiSettings>('/prefs/ai', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });

  const handleModelChange = (value: string) => {
    updateSettings.mutate({
      task_models: {
        ...settings?.task_models,
        deep_research: value || undefined,
      },
    });
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Deep Research</h2>
        <p className="text-muted">
          Configure the AI model used for deep research runs. This affects plan generation, execution, delta analysis, and novelty scoring.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Research Model</h3>
        <p className="text-muted">
          Select the model to use for deep research tasks. Defaults to your AI provider default if not set.
        </p>

        <div className="form-field">
          <label>Deep Research Model</label>
          <select
            value={settings?.task_models?.deep_research || ''}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({TASK_MODEL_DEFAULTS.deep_research})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          {models.length === 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              No models loaded. Go to AI Provider → Refresh Models first.
            </p>
          )}
        </div>

        <div className="settings-message settings-message--info" style={{ marginTop: '16px' }}>
          <strong>Tip:</strong> Deep research is token-intensive. Consider using a high-context model (100k+ tokens) with good reasoning capabilities for best results.
        </div>
      </div>

      {updateSettings.isError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px' }}>Failed to save — check the API connection.</p>
      )}
      {updateSettings.isSuccess && (
        <p style={{ color: 'var(--accent)', fontSize: '13px' }}>Saved.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nutrition settings section
// ---------------------------------------------------------------------------

const NUTRITION_MODEL_DEFAULTS = {
  meal_image_analysis: 'google/gemini-2.5-flash',
  daily_review: 'x-ai/grok-4.1-fast',
  weekly_review: 'x-ai/grok-4.1-fast',
  recipe_generation: 'x-ai/grok-4.1-fast',
  craving_assistant: 'x-ai/grok-4.1-fast',
} as const;

function NutritionSection() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () =>
      api.get<AiSettings>('/prefs/ai').catch((): AiSettings => ({ temperature: 0.2, max_tokens: 4000 })),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () =>
      api.get<{ models: ModelInfo[] }>('/models').catch(() => ({ models: [] })),
  });

  const { data: visionModelsData } = useQuery({
    queryKey: ['vision-models'],
    queryFn: () =>
      api.get<{ models: ModelInfo[]; count: number }>('/models/vision').catch(() => ({ models: [], count: 0 })),
  });

  const models = modelsData?.models ?? [];
  const visionModels = visionModelsData?.models ?? [];

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<AiSettings>) => api.put<AiSettings>('/prefs/ai', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });

  const handleNutritionModelChange = (key: keyof NonNullable<AiSettings['nutrition_models']>, value: string) => {
    updateSettings.mutate({
      nutrition_models: {
        ...settings?.nutrition_models,
        [key]: value || undefined,
      },
    });
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Nutrition Module</h2>
        <p className="text-muted">
          Configure AI models for meal analysis, daily/weekly reviews, recipe generation, and the craving assistant.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Meal Image Analysis</h3>
        <p className="text-muted">Vision model used to analyze meal photos and estimate nutritional content.</p>

        <div className="form-field">
          <label>Meal Analysis Model</label>
          <select
            value={settings?.nutrition_models?.meal_image_analysis || ''}
            onChange={(e) => handleNutritionModelChange('meal_image_analysis', e.target.value)}
            disabled={visionModels.length === 0}
          >
            <option value="">Default ({NUTRITION_MODEL_DEFAULTS.meal_image_analysis})</option>
            {visionModels.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          {visionModels.length === 0 && models.length > 0 && (
            <p className="text-muted" style={{ marginTop: '4px', fontSize: '12px' }}>
              No vision models loaded. Refresh models in AI Provider first.
            </p>
          )}
        </div>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Review Models</h3>
        <p className="text-muted">Models used for generating daily and weekly nutrition summaries.</p>

        <div className="form-field">
          <label>Daily Review Model</label>
          <select
            value={settings?.nutrition_models?.daily_review || ''}
            onChange={(e) => handleNutritionModelChange('daily_review', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({NUTRITION_MODEL_DEFAULTS.daily_review})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Weekly Review Model</label>
          <select
            value={settings?.nutrition_models?.weekly_review || ''}
            onChange={(e) => handleNutritionModelChange('weekly_review', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({NUTRITION_MODEL_DEFAULTS.weekly_review})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Generation Models</h3>
        <p className="text-muted">Models used for recipe generation and the craving assistant.</p>

        <div className="form-field">
          <label>Recipe Generation Model</label>
          <select
            value={settings?.nutrition_models?.recipe_generation || ''}
            onChange={(e) => handleNutritionModelChange('recipe_generation', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({NUTRITION_MODEL_DEFAULTS.recipe_generation})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Craving Assistant Model</label>
          <select
            value={settings?.nutrition_models?.craving_assistant || ''}
            onChange={(e) => handleNutritionModelChange('craving_assistant', e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({NUTRITION_MODEL_DEFAULTS.craving_assistant})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {updateSettings.isError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px' }}>Failed to save — check the API connection.</p>
      )}
      {updateSettings.isSuccess && (
        <p style={{ color: 'var(--accent)', fontSize: '13px' }}>Saved.</p>
      )}
    </div>
  );
}

function ExtensionSection() {
  const { data: tokenData } = useQuery({
    queryKey: ['extension-token'],
    queryFn: () => api.get<{ token: string }>('/prefs/extension-token'),
  });

  const [copied, setCopied] = useState(false);

  const copyToken = () => {
    if (tokenData?.token) {
      navigator.clipboard.writeText(tokenData.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Extension Connection</h2>
        <p className="text-muted">
          Connect the Chrome extension to save content to Links.
        </p>
      </div>

      <div className="settings-group panel panel--extension" style={{ zIndex: 1 }}>
        <h3 className="settings-group__title">Authentication Token</h3>
        <p className="text-muted">
          Copy this token and paste it into the Links extension options page to connect.
        </p>

        <div className="form-field">
          <label>Extension Token</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={tokenData?.token || 'Loading...'}
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
            <button className="button button--secondary" onClick={copyToken}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: '8px', fontSize: '12px' }}>
            <strong>Security Note:</strong> Treat this token like a password. Do not share it.
          </p>
        </div>

        <div className="settings-message settings-message--info" style={{ marginTop: '16px' }}>
          <strong>How to connect:</strong>
          <ol style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.6' }}>
            <li>Install the links chrome extension</li>
            <li>Right-click the extension icon and select <strong>Options</strong>.</li>
            <li>Paste this token into the <strong>Auth Token</strong> field.</li>
            <li>Enter <code>http://127.0.0.1:3000</code> as the Endpoint.</li>
            <li>Click <strong>Save</strong>.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automation settings section
// ---------------------------------------------------------------------------

const AUTOMATION_MODEL_DEFAULT = 'x-ai/grok-4.1-fast';

function AutomationSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: prefsData } = useQuery({
    queryKey: ['automation-prefs'],
    queryFn: () => api.get<{ prefs: AutomationPrefs }>('/prefs/automation').catch(() => ({ prefs: {} as AutomationPrefs })),
  });

  const { data: potsData } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });

  const { data: modelsData } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<{ models: ModelInfo[] }>('/models').catch(() => ({ models: [] })),
  });

  const prefs = prefsData?.prefs ?? {};
  const pots = potsData?.pots ?? [];
  const models = modelsData?.models ?? [];

  const [defaultModel, setDefaultModel] = useState('');
  const [timezone, setTimezone] = useState('');
  const [maxHeartbeat, setMaxHeartbeat] = useState(4);
  const [maxTasks, setMaxTasks] = useState(10);
  const [proactiveMainChatEnabled, setProactiveMainChatEnabled] = useState(false);
  const [proactiveMainChatModel, setProactiveMainChatModel] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (prefs && !initialized) {
      setDefaultModel(prefs.default_model ?? '');
      setTimezone(prefs.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setMaxHeartbeat(prefs.max_heartbeat_runs_per_day ?? 4);
      setMaxTasks(prefs.max_tasks_created_per_day ?? 10);
      setProactiveMainChatEnabled(prefs.proactive_main_chat_enabled ?? false);
      setProactiveMainChatModel(prefs.proactive_main_chat_model ?? '');
      setInitialized(true);
    }
  }, [prefs, initialized]);

  const savePrefs = useMutation({
    mutationFn: (patch: AutomationPrefs) => api.put('/prefs/automation', { prefs: patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-prefs'] });
      setMessage({ type: 'success', text: 'Automation preferences saved.' });
      setTimeout(() => setMessage(null), 3000);
    },
    onError: () => {
      setMessage({ type: 'error', text: 'Failed to save preferences.' });
    },
  });

  const handleSave = () => {
    savePrefs.mutate({
      default_model: defaultModel || undefined,
      timezone: timezone || undefined,
      max_heartbeat_runs_per_day: maxHeartbeat,
      max_tasks_created_per_day: maxTasks,
      proactive_main_chat_enabled: proactiveMainChatEnabled,
      proactive_main_chat_model: proactiveMainChatModel || undefined,
    });
  };

  return (
    <div className="settings-section">
      <div className="settings-section__header">
        <h2>Automation & Heartbeat</h2>
        <p className="text-muted">
          Global defaults for automation, heartbeat generation, and agent-managed tasks.
          Per-pot settings are configured in each pot's Automation tab.
        </p>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Global Defaults</h3>

        <div className="form-field">
          <label>Default Heartbeat Model</label>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">Default ({AUTOMATION_MODEL_DEFAULT})</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          <p className="text-muted" style={{ marginTop: 4, fontSize: 12 }}>
            Model used to generate heartbeat snapshots. Can be overridden per pot.
          </p>
        </div>

        <div className="form-field">
          <label>Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York"
          />
          <p className="text-muted" style={{ marginTop: 4, fontSize: 12 }}>
            IANA timezone for scheduled task times. Detected: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-field">
            <label>Max Heartbeat Runs / Day</label>
            <input
              type="number"
              min={1}
              max={24}
              value={maxHeartbeat}
              onChange={(e) => setMaxHeartbeat(Math.max(1, parseInt(e.target.value, 10) || 4))}
            />
          </div>
          <div className="form-field">
            <label>Max Agent Tasks / Day</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxTasks}
              onChange={(e) => setMaxTasks(Math.max(1, parseInt(e.target.value, 10) || 10))}
            />
          </div>
        </div>

      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Proactive Main Chat</h3>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Agent randomly starts conversations in Main Chat based on your past chat history —
          learning what you enjoy talking about over time. Fires 1–2 times per day.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={proactiveMainChatEnabled}
            onChange={(e) => setProactiveMainChatEnabled(e.target.checked)}
          />
          <span>Enable proactive main chat conversations</span>
        </label>
        {proactiveMainChatEnabled && (
          <div className="form-field" style={{ marginTop: 12 }}>
            <label>Model (optional)</label>
            <input
              type="text"
              value={proactiveMainChatModel}
              onChange={(e) => setProactiveMainChatModel(e.target.value)}
              placeholder="Default (x-ai/grok-4.1-fast)"
              className="form-input"
            />
          </div>
        )}
      </div>

      {message && (
        <p style={{ fontSize: 12, color: message.type === 'success' ? 'var(--green-1, #4caf50)' : 'var(--red-1, #f44336)', margin: '0 0 8px' }}>
          {message.text}
        </p>
      )}
      <div style={{ marginBottom: 24 }}>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={savePrefs.isPending}
        >
          {savePrefs.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="settings-group panel">
        <h3 className="settings-group__title">Per-Pot Configuration</h3>
        <p className="text-muted">
          Configure heartbeat, tasks, and agent permissions individually for each research pot.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
          {pots.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
              No pots yet. Create a pot first.
            </p>
          ) : (
            pots.map((pot) => (
              <div
                key={pot.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 13,
                }}
              >
                <span>
                  {pot.icon_emoji && <span style={{ marginRight: 6 }}>{pot.icon_emoji}</span>}
                  {pot.name}
                </span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => navigate(`/pots/${pot.id}?tab=automation`)}
                >
                  Configure →
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
