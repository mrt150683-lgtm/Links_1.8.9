import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage, ModelInfo, PotChatSettings } from '../pot-chat/potChatTypes';
import { DEFAULT_SETTINGS } from '../pot-chat/potChatTypes';
import type { MainChatAdapter, MainChatThread, MainChatNotification, MainChatContextPack } from './mainChatAdapter';
import type { ExecutionMode } from '../pot-chat/adapter';
import MomStatusStrip from '../mom/MomStatusStrip';
import MomTraceDrawer from '../mom/MomTraceDrawer';
import { useVoiceController } from '../voice/useVoiceController.js';
import { VoicePanel } from '../voice/VoicePanel.js';

import { Header } from './components/Header';
import { Timeline } from '../pot-chat/components/Timeline';
import { Composer } from '../pot-chat/components/Composer';
import { SettingsModal, type MomModels } from '../pot-chat/components/SettingsModal';

import '../pot-chat/PotChat.css';
import './MainChat.css';

// ── Props ────────────────────────────────────────────────────────────

export interface MainChatProps {
  adapter: MainChatAdapter;
  models: ModelInfo[];
  selectedModelId: string;
  onSelectedModelIdChange?: (id: string) => void;
  onNavigateHome?: () => void;
  storageKey?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function loadSettings(storageKey: string): PotChatSettings {
  try {
    const raw = localStorage.getItem(`${storageKey}:settings`);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(storageKey: string, settings: PotChatSettings) {
  try {
    localStorage.setItem(`${storageKey}:settings`, JSON.stringify(settings));
  } catch { /* ignore */ }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const NOTIF_TYPE_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  triage: 'Triage',
  insight: 'Insight',
  goal_aligned: 'Goal',
  reminder: 'Reminder',
  system: 'System',
  conversation: 'Agent',
};

// ── Component ────────────────────────────────────────────────────────

export default function MainChat({
  adapter,
  models,
  selectedModelId,
  onSelectedModelIdChange,
  onNavigateHome,
  storageKey = 'main-chat',
}: MainChatProps) {
  // ── Thread state ───────────────────────────────────────────────────
  const [threads, setThreads] = useState<MainChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // ── Notification state ─────────────────────────────────────────────
  const [notifications, setNotifications] = useState<MainChatNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Context pack (Slice 3) ─────────────────────────────────────────
  const [contextPack, setContextPack] = useState<MainChatContextPack | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const isNewEmptyThread = currentThreadId === null && messages.length === 0;

  // ── UI state ───────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<'conversations' | 'inbox'>('conversations');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('single');
  const [activeMomRunId, setActiveMomRunId] = useState<string | null>(null);
  const [traceDrawerRunId, setTraceDrawerRunId] = useState<string | null>(null);
  const [momModels, setMomModels] = useState<MomModels>({ planner: 'x-ai/grok-4.1-fast', specialist: 'x-ai/grok-4.1-fast', merge: 'x-ai/grok-4.1-fast' });

  // ── Settings ───────────────────────────────────────────────────────
  const [settings, setSettingsState] = useState<PotChatSettings>(() => loadSettings(storageKey));

  const updateSettings = useCallback((next: PotChatSettings) => {
    setSettingsState(next);
    saveSettings(storageKey, next);
  }, [storageKey]);

  // ── Refs ───────────────────────────────────────────────────────────
  const timelineRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ── Derived ────────────────────────────────────────────────────────
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];
  const usedTokensEstimate = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);

  // ── Load data on mount ─────────────────────────────────────────────
  useEffect(() => {
    adapter.listThreads().then(setThreads).catch(() => { /* non-fatal */ });
    adapter.listNotifications().then(setNotifications).catch(() => { /* non-fatal */ });
    adapter.getUnreadCount().then(setUnreadCount).catch(() => { /* non-fatal */ });
    adapter.getContextPack().then(setContextPack).catch(() => { /* non-fatal */ });
  }, [adapter]);

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

  const saveMomModels = useCallback((next: MomModels) => {
    setMomModels(next);
    fetch('/prefs/ai', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mom_models: next }),
    }).catch(() => {});
  }, []);

  // ── Voice controller ────────────────────────────────────────────────
  const handleVoiceTurnComplete = useCallback((transcript: string, response: string) => {
    const ts = new Date().toISOString();
    setMessages((prev) => {
      const msgs = [
        ...prev,
        { id: `voice-u-${Date.now()}`, role: 'user' as const, content: transcript, timestamp: ts },
      ];
      if (response) {
        msgs.push({ id: `voice-a-${Date.now() + 1}`, role: 'assistant' as const, content: response, timestamp: ts });
      }
      return msgs;
    });
  }, []);

  const { state: voiceState, toggleVoice } = useVoiceController({ onTurnComplete: handleVoiceTurnComplete });

  // ── Auto-scroll ────────────────────────────────────────────────────
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        composerRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          setIsSettingsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isFullscreen]);

  // ── Load a thread's messages ───────────────────────────────────────
  const loadThread = useCallback(async (threadId: string) => {
    setCurrentThreadId(threadId);
    setMessages([]);
    try {
      const msgs = await adapter.getThreadMessages(threadId);
      setMessages(msgs);
    } catch { /* non-fatal */ }
  }, [adapter]);

  // ── New thread ────────────────────────────────────────────────────
  const handleNewThread = useCallback(() => {
    setCurrentThreadId(null);
    setMessages([]);
    composerRef.current?.focus();
  }, []);

  // ── Delete thread ─────────────────────────────────────────────────
  const handleDeleteThread = useCallback(async (threadId: string) => {
    await adapter.deleteThread(threadId).catch(() => { /* non-fatal */ });
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (currentThreadId === threadId) {
      setCurrentThreadId(null);
      setMessages([]);
    }
  }, [adapter, currentThreadId]);

  // ── Replay completion ─────────────────────────────────────────────
  const handleReplayComplete = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === msgId ? { ...m, replayState: 'final' as const } : m)
    );
  }, []);

  // ── Open inbox (bell click) ────────────────────────────────────────
  const handleOpenInbox = useCallback(() => {
    setActivePanel('inbox');
    setIsRightPanelOpen(true);
    // Refresh notifications
    adapter.listNotifications().then(setNotifications).catch(() => { /* non-fatal */ });
    adapter.getUnreadCount().then(setUnreadCount).catch(() => { /* non-fatal */ });
  }, [adapter]);

  // ── Notification: open in chat ─────────────────────────────────────
  const handleOpenNotificationInChat = useCallback(async (n: MainChatNotification) => {
    // Mark as opened
    await adapter.openNotification(n.id).catch(() => { /* non-fatal */ });
    setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, state: 'opened' } : x));
    setUnreadCount((c) => Math.max(0, c - (n.state === 'unread' ? 1 : 0)));

    // Build a type-specific message so the AI gets real context, not just generic text
    const payload = n.payload as Record<string, unknown> | null;
    let autoMessage: string;
    switch (n.type) {
      case 'triage': {
        const count = payload?.entry_count as number | undefined;
        autoMessage = count
          ? `I have ${count} new items captured recently. Can you review them and tell me what topics they cover and how I should triage them?`
          : `Help me review and triage my recently captured items.`;
        break;
      }
      case 'insight': {
        const dateYmd = payload?.date_ymd as string | undefined;
        autoMessage = dateYmd
          ? `What's in my daily journal for ${dateYmd}? Summarise the key highlights and any notable activity.`
          : `What's in my daily journal? Summarise the key highlights.`;
        break;
      }
      case 'greeting': {
        const timeOfDay = payload?.time_of_day as string | undefined;
        autoMessage = `Good ${timeOfDay ?? 'day'}! What should I focus on based on my recent research activity?`;
        break;
      }
      case 'conversation': {
        // Thread already has an AI opening message — just navigate to it
        const threadId = (payload as Record<string, unknown> | null)?.thread_id as string | undefined;
        if (threadId) {
          setBannerDismissed(true);
          setActivePanel('conversations');
          setActiveMomRunId(null);
          await loadThread(threadId);
          adapter.listThreads().then(setThreads).catch(() => { /* non-fatal */ });
        }
        return;
      }
      default:
        autoMessage = n.preview ? `${n.title} — ${n.preview}` : n.title;
    }

    // Start a fresh thread, switch to chat, and auto-send with full context loaded
    setCurrentThreadId(null);
    setMessages([]);
    setBannerDismissed(true);
    setActivePanel('conversations');
    setActiveMomRunId(null);

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: autoMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages([userMsg]);
    setIsSending(true);

    try {
      const result = await adapter.sendMessage({
        thread_id: undefined,
        model_id: selectedModelId,
        content: autoMessage,
        include_context: true,
        execution_mode: executionMode,
      });

      if (result.mom_run_id) setActiveMomRunId(result.mom_run_id);
      setCurrentThreadId(result.thread_id);

      const assistantMsg: ChatMessage = {
        ...result.assistantMessage,
        replayState: settings.replayEnabled ? 'replaying' : 'final',
      };
      setMessages((prev) => [...prev, assistantMsg]);

      adapter.listThreads().then((ts) => {
        setThreads(ts);
        setCurrentThreadId(result.thread_id);
      }).catch(() => { /* non-fatal */ });

    } catch (err) {
      const errMsg: ChatMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsSending(false);
    }
  }, [adapter, selectedModelId, settings.replayEnabled, executionMode]);

  // ── Welcome banner pill click ─────────────────────────────────────
  const handleWelcomePillClick = useCallback(async (
    type: 'journal' | 'entries' | 'digest' | 'notifications',
    meta?: Record<string, string>,
  ) => {
    if (type === 'notifications') {
      handleOpenInbox();
      return;
    }

    let autoMessage: string;
    switch (type) {
      case 'journal':
        autoMessage = meta?.date
          ? `What's in my daily journal for ${meta.date}? Summarise the key highlights and activity.`
          : `What's in today's journal? Summarise the key highlights.`;
        break;
      case 'entries':
        autoMessage = meta?.count
          ? `I have ${meta.count} new items captured recently. Help me review and triage them — what topics and themes do they cover?`
          : `Help me review and triage my recently captured items.`;
        break;
      case 'digest':
        autoMessage = meta?.date
          ? `Give me my weekly research digest for the week of ${meta.date}. What were the key themes and highlights?`
          : `Give me my weekly research digest. What did I research this week?`;
        break;
      default:
        return;
    }

    setBannerDismissed(true);
    setCurrentThreadId(null);
    setMessages([]);
    setActivePanel('conversations');
    setActiveMomRunId(null);

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: autoMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages([userMsg]);
    setIsSending(true);

    try {
      const result = await adapter.sendMessage({
        thread_id: undefined,
        model_id: selectedModelId,
        content: autoMessage,
        include_context: true,
        execution_mode: executionMode,
      });
      if (result.mom_run_id) setActiveMomRunId(result.mom_run_id);
      setCurrentThreadId(result.thread_id);
      setMessages((prev) => [
        ...prev,
        { ...result.assistantMessage, replayState: settings.replayEnabled ? 'replaying' as const : 'final' as const },
      ]);
      adapter.listThreads().then(setThreads).catch(() => { /* non-fatal */ });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now() + 1}`,
          role: 'assistant' as const,
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }, [adapter, selectedModelId, settings.replayEnabled, executionMode, handleOpenInbox]);

  // ── Notification: dismiss ──────────────────────────────────────────
  const handleDismissNotification = useCallback(async (id: string) => {
    await adapter.dismissNotification(id).catch(() => { /* non-fatal */ });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((c) => Math.max(0, c - 1));
    // Refresh accurate count
    adapter.getUnreadCount().then(setUnreadCount).catch(() => { /* non-fatal */ });
  }, [adapter]);

  // ── Notification: snooze ──────────────────────────────────────────
  const handleSnoozeNotification = useCallback(async (id: string) => {
    await adapter.snoozeNotification(id, 24).catch(() => { /* non-fatal */ });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, [adapter]);

  // ── Send message ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!composerText.trim() || isSending) return;

    const userMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: composerText.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setComposerText('');
    setIsSending(true);
    setActiveMomRunId(null);

    try {
      const isFirstMessage = currentThreadId === null;
      const result = await adapter.sendMessage({
        thread_id: currentThreadId ?? undefined,
        model_id: selectedModelId,
        content: userMsg.content,
        include_context: isFirstMessage,
        execution_mode: executionMode,
      });

      if (result.mom_run_id) {
        setActiveMomRunId(result.mom_run_id);
      }

      // Set thread ID (handles first-message new-thread case)
      if (!currentThreadId) {
        setCurrentThreadId(result.thread_id);
      }

      const assistantMsg: ChatMessage = {
        ...result.assistantMessage,
        replayState: settings.replayEnabled ? 'replaying' : 'final',
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Refresh thread list
      adapter.listThreads().then((ts) => {
        setThreads(ts);
        if (!currentThreadId) {
          setCurrentThreadId(result.thread_id);
        }
      }).catch(() => { /* non-fatal */ });

    } catch (err) {
      const errMsg: ChatMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsSending(false);
    }
  }, [composerText, currentThreadId, adapter, selectedModelId, settings.replayEnabled, isSending]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className={`main-chat${isFullscreen ? ' main-chat--fullscreen' : ''}`}>
      {/* Main Chat Area */}
      <div className="main-chat__main">
        <Header
          selectedModel={selectedModel || { id: '', displayName: 'No model', contextWindowTokens: 128000 }}
          usedTokensEstimate={usedTokensEstimate}
          isRightPanelOpen={isRightPanelOpen}
          isFullscreen={isFullscreen}
          settings={settings}
          unreadCount={unreadCount}
          activePanel={activePanel}
          onToggleRightPanel={() => setIsRightPanelOpen((v) => !v)}
          onToggleFullscreen={() => setIsFullscreen((v) => !v)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onNavigateHome={onNavigateHome}
          onOpenInbox={handleOpenInbox}
        />

        {/* Welcome banner (Slice 3) — shown on new empty threads */}
        {isNewEmptyThread && contextPack && !bannerDismissed && (
          <div className="main-chat__welcome-banner">
            <button
              className="main-chat__welcome-dismiss"
              onClick={() => setBannerDismissed(true)}
              title="Dismiss"
            >×</button>
            <div className="main-chat__welcome-greeting">{contextPack.greeting}</div>
            <div className="main-chat__welcome-lines">
              {contextPack.recent_entry_count > 0 && (
                <button
                  className="main-chat__welcome-pill main-chat__welcome-pill--clickable"
                  onClick={() => handleWelcomePillClick('entries', { count: String(contextPack.recent_entry_count) })}
                  title="Review recent items in chat"
                >
                  {contextPack.recent_entry_count} new item{contextPack.recent_entry_count !== 1 ? 's' : ''}
                </button>
              )}
              {contextPack.notification_count > 0 && (
                <button
                  className="main-chat__welcome-pill main-chat__welcome-pill--alert main-chat__welcome-pill--clickable"
                  onClick={() => handleWelcomePillClick('notifications')}
                  title="Open inbox"
                >
                  {contextPack.notification_count} notification{contextPack.notification_count !== 1 ? 's' : ''}
                </button>
              )}
              {contextPack.latest_journal && (
                <button
                  className="main-chat__welcome-pill main-chat__welcome-pill--journal main-chat__welcome-pill--clickable"
                  onClick={() => handleWelcomePillClick('journal', { date: contextPack.latest_journal!.date })}
                  title="Open journal in chat"
                >
                  Journal: {contextPack.latest_journal.date}
                </button>
              )}
              {contextPack.latest_digest && (
                <button
                  className="main-chat__welcome-pill main-chat__welcome-pill--digest main-chat__welcome-pill--clickable"
                  onClick={() => handleWelcomePillClick('digest', { date: contextPack.latest_digest!.date })}
                  title="View weekly research digest"
                >
                  Digest: {contextPack.latest_digest.date}
                </button>
              )}
            </div>
            {contextPack.latest_journal?.first_line && (
              <div className="main-chat__welcome-journal-line">
                {contextPack.latest_journal.first_line}
              </div>
            )}
            {contextPack.latest_digest?.headline && !contextPack.latest_journal?.first_line && (
              <div className="main-chat__welcome-journal-line">
                {contextPack.latest_digest.headline}
              </div>
            )}
          </div>
        )}

        <Timeline
          ref={timelineRef}
          messages={messages}
          entries={[]}
          showSourceSnippets={settings.showSourceSnippets}
          compactMode={settings.compactMode}
          replayEnabled={settings.replayEnabled}
          replaySpeed={settings.replaySpeed}
          isSending={isSending}
          onOpenEntry={() => { /* no-op: no pot entries in MainChat */ }}
          onAddToContext={() => { /* no-op */ }}
          onReplayComplete={handleReplayComplete}
        />

        {/* MoM status strip */}
        {executionMode !== 'single' && (
          <MomStatusStrip
            runId={activeMomRunId}
            isLoading={isSending}
            onViewTrace={(id) => setTraceDrawerRunId(id)}
            onComplete={() => {
              // Reload messages — worker updated the placeholder message
              if (!currentThreadId) return;
              adapter.getThreadMessages(currentThreadId).then((msgs) => {
                setMessages(msgs);
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
            isSaved={false}
            compactMode={settings.compactMode}
            disabled={isSending}
            executionMode={executionMode}
            isVoiceActive={voiceState.isActive}
            onChange={setComposerText}
            onSend={handleSend}
            onSave={() => { /* no-op */ }}
            onOpenBrowser={() => { /* no-op */ }}
            onCycleMode={cycleMode}
            onToggleVoice={toggleVoice}
          />
        </div>
      </div>

      {/* Right Panel */}
      {isRightPanelOpen && (
        <div className="main-chat__right-panel">
          {/* Panel tabs */}
          <div className="main-chat__panel-tabs">
            <button
              className={`main-chat__panel-tab${activePanel === 'conversations' ? ' main-chat__panel-tab--active' : ''}`}
              onClick={() => setActivePanel('conversations')}
            >
              Conversations
            </button>
            <button
              className={`main-chat__panel-tab${activePanel === 'inbox' ? ' main-chat__panel-tab--active' : ''}`}
              onClick={() => {
                setActivePanel('inbox');
                adapter.listNotifications().then(setNotifications).catch(() => { /* non-fatal */ });
                adapter.getUnreadCount().then(setUnreadCount).catch(() => { /* non-fatal */ });
              }}
            >
              Inbox
              {unreadCount > 0 && (
                <span className="main-chat__tab-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
          </div>

          {/* Conversations panel */}
          {activePanel === 'conversations' && (
            <>
              <div className="main-chat__panel-header">
                <span className="main-chat__panel-title">Conversations</span>
                <button
                  onClick={handleNewThread}
                  className="main-chat__new-thread-btn"
                  title="New conversation"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New
                </button>
              </div>

              <div className="main-chat__thread-list">
                {threads.length === 0 ? (
                  <div className="main-chat__thread-empty">
                    No conversations yet. Send a message to start one.
                  </div>
                ) : (
                  threads.map((t) => (
                    <div
                      key={t.id}
                      className={`main-chat__thread-item ${t.id === currentThreadId ? 'main-chat__thread-item--active' : ''}`}
                      onClick={() => loadThread(t.id)}
                    >
                      <div className="main-chat__thread-title">
                        {t.title || `Conversation`}
                      </div>
                      <div className="main-chat__thread-meta">
                        {t.message_count} msg{t.message_count !== 1 ? 's' : ''} ·{' '}
                        {new Date(t.lastUpdatedAt).toLocaleDateString()}
                      </div>
                      <button
                        className="main-chat__thread-delete"
                        onClick={(e) => { e.stopPropagation(); handleDeleteThread(t.id); }}
                        title="Delete conversation"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* Inbox panel */}
          {activePanel === 'inbox' && (
            <>
              <div className="main-chat__panel-header">
                <span className="main-chat__panel-title">Inbox</span>
                {notifications.length > 0 && (
                  <button
                    className="main-chat__new-thread-btn"
                    onClick={() => {
                      // Dismiss all
                      notifications.forEach((n) => adapter.dismissNotification(n.id).catch(() => {}));
                      setNotifications([]);
                      setUnreadCount(0);
                    }}
                    title="Dismiss all"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="main-chat__notification-list">
                {notifications.length === 0 ? (
                  <div className="main-chat__thread-empty">
                    No notifications. You're all caught up.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`main-chat__notification-card${n.state === 'unread' ? ' main-chat__notification-card--unread' : ''}`}
                    >
                      <div className="main-chat__notification-header">
                        <span className="main-chat__notification-type">
                          {NOTIF_TYPE_LABELS[n.type] ?? n.type}
                        </span>
                        <span className="main-chat__notification-time">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <div className="main-chat__notification-title">{n.title}</div>
                      {n.preview && (
                        <div className="main-chat__notification-preview">{n.preview}</div>
                      )}
                      <div className="main-chat__notification-actions">
                        <button
                          className="main-chat__notif-action main-chat__notif-action--primary"
                          onClick={() => handleOpenNotificationInChat(n)}
                          title="Open in chat"
                        >
                          Open in chat
                        </button>
                        <button
                          className="main-chat__notif-action"
                          onClick={() => handleSnoozeNotification(n.id)}
                          title="Snooze for 24 hours"
                        >
                          Snooze
                        </button>
                        <button
                          className="main-chat__notif-action main-chat__notif-action--dismiss"
                          onClick={() => handleDismissNotification(n.id)}
                          title="Dismiss"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings Modal */}
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
