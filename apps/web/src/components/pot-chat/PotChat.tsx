import { useState, useEffect, useRef, useCallback } from 'react';
import type { PotEntry, ChatThread, ChatMessage, ActiveContextItem, ModelInfo, PotChatSettings } from './potChatTypes';
import { DEFAULT_SETTINGS } from './potChatTypes';
import type { PotChatAdapter, ExecutionMode } from './adapter';
import { estimateActiveContextTokens } from './contextPayload';
import MomStatusStrip from '../mom/MomStatusStrip';
import MomTraceDrawer from '../mom/MomTraceDrawer';
import { useVoiceController } from '../voice/useVoiceController.js';
import { VoicePanel } from '../voice/VoicePanel.js';

import { Header } from './components/Header';
import { Timeline } from './components/Timeline';
import { Composer } from './components/Composer';
import { ActiveContextPanel } from './components/ActiveContextPanel';
import { KnowledgeBrowser } from './components/KnowledgeBrowser';
import { EntryViewerModal } from './components/EntryViewerModal';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { SettingsModal } from './components/SettingsModal';
import { CalendarDrawer } from './CalendarDrawer';
import '@/pages/Calendar.css';

import './PotChat.css';

// ── Props ────────────────────────────────────────────────────────────

export interface PotChatProps {
  potId: string;
  adapter: PotChatAdapter;
  models: ModelInfo[];
  selectedModelId: string;
  onSelectedModelIdChange?: (id: string) => void;
  onNavigateHome?: () => void;
  ctxUsage?: { usedTokensEstimate: number; availableTokensEstimate: number };
  initialSettings?: Partial<PotChatSettings>;
  storageKey?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function loadSettings(storageKey: string, initial?: Partial<PotChatSettings>): PotChatSettings {
  try {
    const raw = localStorage.getItem(`${storageKey}:settings`);
    if (raw) return { ...DEFAULT_SETTINGS, ...(initial ?? {}), ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS, ...(initial ?? {}) };
}

function saveSettings(storageKey: string, settings: PotChatSettings) {
  try {
    localStorage.setItem(`${storageKey}:settings`, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function nowIso(adapter: PotChatAdapter): string {
  return adapter.nowIso ? adapter.nowIso() : new Date().toISOString();
}

// ── Component ────────────────────────────────────────────────────────

export default function PotChat({
  potId,
  adapter,
  models,
  selectedModelId,
  onSelectedModelIdChange,
  onNavigateHome,
  ctxUsage,
  initialSettings,
  storageKey = 'pot-chat',
}: PotChatProps) {
  // ── Data state ─────────────────────────────────────────────────────
  const [entries, setEntries] = useState<PotEntry[]>([]);
  const [chatThread, setChatThread] = useState<ChatThread | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveContextItem[]>([]);

  // ── UI state ───────────────────────────────────────────────────────
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<'context' | 'browser' | 'calendar'>('context');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<PotEntry | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  // dykAutoSendRef must be declared before composerText useState so the lazy
  // initializer can set it, and the settings initializer can read it.
  const dykAutoSendRef = useRef(false);
  const [composerText, setComposerText] = useState(() => {
    const seed = sessionStorage.getItem('dyk_chat_seed');
    if (seed) {
      sessionStorage.removeItem('dyk_chat_seed');
      dykAutoSendRef.current = true;
      return seed;
    }
    return '';
  });
  const [isSaved, setIsSaved] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('single');
  const [activeMomRunId, setActiveMomRunId] = useState<string | null>(null);
  const [traceDrawerRunId, setTraceDrawerRunId] = useState<string | null>(null);
  const [momModels, setMomModels] = useState({ planner: 'x-ai/grok-4.1-fast', specialist: 'x-ai/grok-4.1-fast', merge: 'x-ai/grok-4.1-fast' });

  // ── Settings ───────────────────────────────────────────────────────
  const [settings, setSettingsState] = useState<PotChatSettings>(() => {
    const base = loadSettings(storageKey, initialSettings);
    // When opened from a DYK insight, force open knowledge mode so the AI
    // can draw on general knowledge rather than being restricted to pot entries.
    if (dykAutoSendRef.current) return { ...base, knowledgeMode: 'open' };
    return base;
  });

  const updateSettings = useCallback((next: PotChatSettings) => {
    setSettingsState(next);
    saveSettings(storageKey, next);
  }, [storageKey]);

  // ── Derived model ──────────────────────────────────────────────────
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];

  // ── Refs ───────────────────────────────────────────────────────────
  const timelineRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Token estimate ─────────────────────────────────────────────────
  const estimateTokens = adapter.estimateTokens ?? defaultEstimateTokens;
  const usedTokensEstimate = ctxUsage?.usedTokensEstimate ?? (
    (chatThread?.messages.reduce((acc, m) => acc + estimateTokens(m.content), 0) ?? 0) +
    estimateActiveContextTokens(activeContext)
  );

  // ── Data loading ───────────────────────────────────────────────────
  useEffect(() => {
    adapter.listEntries(potId).then(setEntries);
    adapter.listThreads(potId).then((threads) => {
      if (threads.length > 0) {
        setChatThread(threads[0]);
      } else {
        // Create empty thread
        setChatThread({
          id: `thread-${Date.now()}`,
          potId,
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          messages: [],
        });
      }
    });
  }, [potId, adapter]);

  // ── Load MoM model preferences ─────────────────────────────────────
  useEffect(() => {
    fetch('/prefs/ai').then((r) => r.json()).then((prefs) => {
      if (prefs?.mom_models) {
        setMomModels((prev) => ({ ...prev, ...prefs.mom_models }));
      }
    }).catch(() => {});
  }, []);

  const MOM_CYCLE: ExecutionMode[] = ['single', 'mom_lite', 'mom_standard', 'mom_heavy'];
  const cycleMode = useCallback(() => {
    setExecutionMode((prev) => {
      const idx = MOM_CYCLE.indexOf(prev);
      return MOM_CYCLE[(idx + 1) % MOM_CYCLE.length];
    });
  }, []);

  const saveMomModels = useCallback((next: typeof momModels) => {
    setMomModels(next);
    fetch('/prefs/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mom_models: next }),
    }).catch(() => {});
  }, []);

  // ── Voice controller ────────────────────────────────────────────────
  const handleVoiceTurnComplete = useCallback((transcript: string, response: string) => {
    const ts = nowIso(adapter);
    setChatThread((prev) => {
      if (!prev) return null;
      const msgs = [
        ...prev.messages,
        { id: `voice-u-${Date.now()}`, role: 'user' as const, content: transcript, timestamp: ts },
      ];
      if (response) {
        msgs.push({ id: `voice-a-${Date.now() + 1}`, role: 'assistant' as const, content: response, timestamp: ts });
      }
      return { ...prev, messages: msgs };
    });
  }, [adapter]);

  const { state: voiceState, toggleVoice } = useVoiceController({ potId, onTurnComplete: handleVoiceTurnComplete });

  // ── DYK auto-send ──────────────────────────────────────────────────
  // When opened from a DYK insight, fire the message automatically once the
  // chat thread is ready, so the answer starts appearing immediately.
  useEffect(() => {
    if (!dykAutoSendRef.current || !chatThread || isSending) return;
    dykAutoSendRef.current = false;
    handleSend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatThread?.id]);

  // ── Auto-scroll ────────────────────────────────────────────────────
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [chatThread?.messages, isSending]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsRightPanelOpen(true);
        setRightPanelTab('browser');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          setIsSettingsOpen(false);
          setViewingEntry(null);
          setViewingImage(null);
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isFullscreen]);

  // ── Auto-save ──────────────────────────────────────────────────────
  const triggerAutoSave = useCallback((thread: ChatThread) => {
    if (!settings.autoSaveChatAsEntry) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const saved = await adapter.saveThreadAsEntry(potId, thread);
      setEntries((prev) => {
        if (prev.some((e) => e.id === saved.id)) return prev;
        return [...prev, saved];
      });
    }, 1000);
  }, [settings.autoSaveChatAsEntry, adapter, potId]);

  // ── Context management ─────────────────────────────────────────────
  const addToActiveContext = useCallback((entry: PotEntry) => {
    setActiveContext((prev) => {
      if (prev.some((a) => a.entry.id === entry.id)) return prev;
      return [...prev, { entry, addedAt: nowIso(adapter) }];
    });
    setIsRightPanelOpen(true);
    setRightPanelTab('context');
  }, [adapter]);

  const removeFromActiveContext = useCallback((id: string) => {
    setActiveContext((prev) => prev.filter((a) => a.entry.id !== id));
  }, []);

  const handleAttachCalendarEntry = useCallback((entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      addToActiveContext(entry);
    }
  }, [entries, addToActiveContext]);

  // ── Send message ───────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!composerText.trim() || !chatThread || isSending) return;

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: composerText.trim(),
      timestamp: nowIso(adapter),
    };

    const updatedThread: ChatThread = {
      ...chatThread,
      messages: [...chatThread.messages, userMsg],
      lastUpdatedAt: nowIso(adapter),
    };

    setChatThread(updatedThread);
    setComposerText('');
    setIsSaved(false);
    setIsSending(true);
    setActiveMomRunId(null);

    try {
      const response = await adapter.sendMessage(
        potId,
        userMsg.content,
        chatThread.id,
        activeContext.map((a) => a.entry.id),
        selectedModelId,
        settings.knowledgeMode,
        executionMode,
      );

      // Capture MoM run ID for status strip
      if (response._momRunId) {
        setActiveMomRunId(response._momRunId);
      }

      setChatThread((prev) => {
        if (!prev) return null;
        const serverThreadId = (response as any)._threadId;
        // Mark new assistant message for replay (if enabled)
        const msgWithReplay: typeof response = {
          ...response,
          replayState: settings.replayEnabled ? 'replaying' : 'final',
        };
        const next = {
          ...prev,
          id: serverThreadId || prev.id,
          messages: [...prev.messages, msgWithReplay],
          lastUpdatedAt: nowIso(adapter),
        };
        triggerAutoSave(next);
        return next;
      });
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: nowIso(adapter),
        isError: true,
      };
      setChatThread((prev) => prev ? { ...prev, messages: [...prev.messages, errMsg] } : null);
    } finally {
      setIsSending(false);
    }
  }, [composerText, chatThread, activeContext, adapter, potId, triggerAutoSave, isSending]);

  // ── Replay completion ───────────────────────────────────────────────
  const handleReplayComplete = useCallback((msgId: string) => {
    setChatThread((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === msgId ? { ...m, replayState: 'final' as const } : m
        ),
      };
    });
  }, []);

  // ── Manual save ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!chatThread) return;
    const saved = await adapter.saveThreadAsEntry(potId, chatThread);
    setIsSaved(true);
    setEntries((prev) => (prev.some((e) => e.id === saved.id) ? prev : [...prev, saved]));
  }, [chatThread, adapter, potId]);

  // ── Loading state ──────────────────────────────────────────────────
  if (!chatThread) {
    return <div className="pot-chat__loading">Loading...</div>;
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className={`pot-chat${isFullscreen ? ' pot-chat--fullscreen' : ''}`}>
      {/* Main Chat Area */}
      <div className="pot-chat__main">
        <Header
          selectedModel={selectedModel || { id: '', displayName: 'No model', contextWindowTokens: 128000 }}
          usedTokensEstimate={usedTokensEstimate}
          isRightPanelOpen={isRightPanelOpen}
          isFullscreen={isFullscreen}
          isCalendarOpen={isRightPanelOpen && rightPanelTab === 'calendar'}
          settings={settings}
          onToggleRightPanel={() => setIsRightPanelOpen((v) => !v)}
          onToggleFullscreen={() => setIsFullscreen((v) => !v)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onNavigateHome={onNavigateHome}
          onToggleKnowledgeMode={() => {
            const next = settings.knowledgeMode === 'strict' ? 'open' : 'strict';
            updateSettings({ ...settings, knowledgeMode: next });
          }}
          onToggleCalendar={() => {
            if (isRightPanelOpen && rightPanelTab === 'calendar') {
              setIsRightPanelOpen(false);
            } else {
              setIsRightPanelOpen(true);
              setRightPanelTab('calendar');
            }
          }}
        />

        <Timeline
          ref={timelineRef}
          messages={chatThread.messages}
          entries={entries}
          showSourceSnippets={settings.showSourceSnippets}
          compactMode={settings.compactMode}
          replayEnabled={settings.replayEnabled}
          replaySpeed={settings.replaySpeed}
          isSending={isSending}
          onOpenEntry={setViewingEntry}
          onAddToContext={addToActiveContext}
          onReplayComplete={handleReplayComplete}
        />

        {/* MoM status strip */}
        {executionMode !== 'single' && (
          <MomStatusStrip
            runId={activeMomRunId}
            isLoading={isSending}
            onViewTrace={(id) => setTraceDrawerRunId(id)}
            onComplete={() => {
              // Reload messages — the worker updated the placeholder message
              if (!chatThread) return;
              adapter.getThreadMessages?.(potId, chatThread.id).then((msgs) => {
                setChatThread((prev) => prev ? { ...prev, messages: msgs } : prev);
              }).catch(() => {});
            }}
            onCancel={() => setActiveMomRunId(null)}
          />
        )}

        <div style={{ position: 'relative' }}>
          {voiceState.isActive && (
            <VoicePanel state={voiceState} onStop={toggleVoice} />
          )}
          <Composer
            ref={composerRef}
            value={composerText}
            isSaved={isSaved}
            compactMode={settings.compactMode}
            disabled={isSending}
            executionMode={executionMode}
            isVoiceActive={voiceState.isActive}
            onChange={setComposerText}
            onSend={handleSend}
            onSave={handleSave}
            onOpenBrowser={() => { setIsRightPanelOpen(true); setRightPanelTab('browser'); }}
            onCycleMode={cycleMode}
            onToggleVoice={toggleVoice}
          />
        </div>
      </div>

      {/* Right Panel */}
      {isRightPanelOpen && (
        <div className="pot-chat__right-panel">
          <div className="pot-chat__panel-tabs">
            <button
              onClick={() => setRightPanelTab('context')}
              className={`pot-chat__panel-tab ${rightPanelTab === 'context' ? 'pot-chat__panel-tab--active' : ''}`}
            >
              Active Context
            </button>
            <button
              onClick={() => setRightPanelTab('browser')}
              className={`pot-chat__panel-tab ${rightPanelTab === 'browser' ? 'pot-chat__panel-tab--active' : ''}`}
            >
              Knowledge Browser
            </button>
            <button
              onClick={() => setRightPanelTab('calendar')}
              className={`pot-chat__panel-tab ${rightPanelTab === 'calendar' ? 'pot-chat__panel-tab--active' : ''}`}
            >
              Calendar
            </button>
          </div>

          <div className="pot-chat__panel-body">
            {rightPanelTab === 'context' ? (
              <ActiveContextPanel
                activeContext={activeContext}
                onRemove={removeFromActiveContext}
                onClearAll={() => setActiveContext([])}
              />
            ) : rightPanelTab === 'browser' ? (
              <KnowledgeBrowser
                entries={entries}
                activeContext={activeContext}
                onOpenEntry={setViewingEntry}
                onAddToContext={addToActiveContext}
                onRemoveFromContext={removeFromActiveContext}
              />
            ) : (
              <CalendarDrawer
                potId={potId}
                onAttachEntry={handleAttachCalendarEntry}
              />
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          models={models}
          selectedModelId={selectedModelId}
          momModels={momModels}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={updateSettings}
          onSelectedModelIdChange={(id) => onSelectedModelIdChange?.(id)}
          onMomModelsChange={saveMomModels}
        />
      )}

      {viewingEntry && (
        <EntryViewerModal
          entry={viewingEntry}
          onClose={() => setViewingEntry(null)}
          onAddToContext={addToActiveContext}
          onViewImage={setViewingImage}
        />
      )}

      {viewingImage && (
        <ImageLightboxModal
          url={viewingImage}
          onClose={() => setViewingImage(null)}
        />
      )}

      {/* MoM Trace Drawer */}
      {traceDrawerRunId && (
        <MomTraceDrawer
          runId={traceDrawerRunId}
          onClose={() => setTraceDrawerRunId(null)}
        />
      )}
    </div>
  );
}
