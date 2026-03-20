/**
 * RightSidebar — Unified right panel (v1.7.3)
 *
 * Replaces individual dropdown panels (Shelf, Sessions, History, Highlights,
 * Privacy, AI Chat) with a single 360px panel that sits in the space vacated
 * by setRightInset(360). No z-index fighting with WebContentsViews.
 *
 * Modes: ai | shelf | sessions | history | highlights | privacy
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import aiChatIcon    from '../assets/icons/AI_chat.png';
import shelfIcon     from '../assets/icons/bookmark.png';
import sessionsIcon  from '../assets/icons/sessions.png';
import historyIcon   from '../assets/icons/history.png';
import highlightsIcon from '../assets/icons/save_selection.png';
import privacyIcon   from '../assets/icons/privacy.png';
import type {
  ShelfItem,
  TabGroup,
  BrowserSession,
  HistoryEntry,
  HighlightBufferEntry,
  PrivacyMode,
} from '../../shared/types.js';

export type RightMode = 'ai' | 'shelf' | 'sessions' | 'history' | 'highlights' | 'privacy';

interface Pot { id: string; name: string; }

interface Props {
  mode: RightMode;
  onModeChange: (mode: RightMode) => void;
  onClose: () => void;
  privacyMode: PrivacyMode;
  onPrivacyChange: (mode: PrivacyMode) => void;
  groups: TabGroup[];
}

const MODE_TABS: { mode: RightMode; icon: string; label: string }[] = [
  { mode: 'ai',         icon: aiChatIcon,     label: 'AI Chat' },
  { mode: 'shelf',      icon: shelfIcon,      label: 'Shelf' },
  { mode: 'sessions',   icon: sessionsIcon,   label: 'Sessions' },
  { mode: 'history',    icon: historyIcon,    label: 'History' },
  { mode: 'highlights', icon: highlightsIcon, label: 'Highlights' },
  { mode: 'privacy',    icon: privacyIcon,    label: 'Privacy' },
];

const CHROME_HEIGHT = 80;

export function RightSidebar({ mode, onModeChange, onClose, privacyMode, onPrivacyChange, groups }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: CHROME_HEIGHT,
        bottom: 0,
        width: 360,
        background: '#0d0d1c',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Mode tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          height: 40,
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
          gap: 1,
        }}
      >
        {MODE_TABS.map(({ mode: m, icon, label }) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            title={label}
            style={{
              background: mode === m ? 'rgba(74,158,255,0.15)' : 'transparent',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              padding: '4px 7px',
              lineHeight: 1,
              transition: 'background 0.1s, opacity 0.1s',
              flexShrink: 0,
              opacity: mode === m ? 1 : 0.45,
            }}
          >
            <img src={icon} alt={label} width={18} height={18} style={{ display: 'block', objectFit: 'contain' }} />
          </button>
        ))}
        <span style={{ flex: 1, fontSize: 11, color: '#444', paddingLeft: 4 }}>
          {MODE_TABS.find((t) => t.mode === mode)?.label}
        </span>
        <button
          onClick={onClose}
          title="Close panel"
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 5,
            color: '#444',
            cursor: 'pointer',
            fontSize: 12,
            padding: '4px 7px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content area — each section manages its own scroll */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {mode === 'ai'         && <AIChatSection />}
        {mode === 'shelf'      && <ShelfSection groups={groups} />}
        {mode === 'sessions'   && <SessionsSection />}
        {mode === 'history'    && <HistorySection />}
        {mode === 'highlights' && <HighlightsSection />}
        {mode === 'privacy'    && <PrivacySection currentMode={privacyMode} onModeChange={onPrivacyChange} />}
      </div>
    </div>
  );
}

// ─── AI Chat ─────────────────────────────────────────────────────────────────

interface Message { role: 'user' | 'assistant'; content: string; }
interface PageCtx { url: string; title: string; text: string; }

const API_BASE = 'http://127.0.0.1:3000';

function AIChatSection() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pageCtx, setPageCtx] = useState<PageCtx | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleLoadPageContext = useCallback(async () => {
    setLoadingCtx(true);
    try {
      const ctx = await window.electronAPI.loadPageContext();
      setPageCtx(ctx);
    } catch { /* ignore */ } finally {
      setLoadingCtx(false);
    }
  }, []);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setPageCtx(null);
    setInput('');
  }, []);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;

    let fullContent = content;
    if (pageCtx) {
      fullContent = `[Page context: "${pageCtx.title}" (${pageCtx.url})]\n\n${pageCtx.text.slice(0, 6000)}\n\n---\n\n${content}`;
      setPageCtx(null);
    }

    setInput('');
    setSending(true);
    setMessages((msgs) => [...msgs, { role: 'user', content }]);

    try {
      const res = await fetch(`${API_BASE}/main-chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fullContent, thread_id: threadId ?? undefined }),
      });
      const data = await res.json() as { thread_id?: string; assistant_message?: { content: string } };
      if (data.thread_id) setThreadId(data.thread_id);
      if (data.assistant_message?.content) {
        setMessages((msgs) => [...msgs, { role: 'assistant', content: data.assistant_message!.content }]);
      }
    } catch {
      setMessages((msgs) => [...msgs, { role: 'assistant', content: 'Could not reach the Links API. Make sure the app is running.' }]);
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, sending, threadId, pageCtx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  return (
    <>
      {/* Quick actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <button onClick={handleLoadPageContext} disabled={loadingCtx} title="Load current page text into context" style={toolBtn(!!pageCtx)}>
          {loadingCtx ? '…' : '📄 Page'}
        </button>
        <button onClick={handleNewConversation} title="Start new conversation" style={toolBtn(false)}>
          ↺ New
        </button>
      </div>

      {/* Page context banner */}
      {pageCtx && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(74,158,255,0.08)', borderBottom: '1px solid rgba(74,158,255,0.12)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#4a9eff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {pageCtx.title || pageCtx.url}
          </span>
          <button onClick={() => setPageCtx(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: '#3a3a5a', fontSize: 12, textAlign: 'center', marginTop: 32, lineHeight: 1.6 }}>
            Ask anything — or click 📄 Page<br />to chat about what you're reading.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '90%',
                padding: '8px 10px',
                borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: msg.role === 'user' ? 'rgba(74,158,255,0.14)' : 'rgba(255,255,255,0.05)',
                border: msg.role === 'user' ? '1px solid rgba(74,158,255,0.18)' : '1px solid rgba(255,255,255,0.06)',
                fontSize: 12,
                lineHeight: 1.55,
                color: msg.role === 'user' ? '#b8ceff' : '#d8d8ec',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ padding: '8px 10px', borderRadius: '12px 12px 12px 3px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 13, color: '#4a4a6a' }}>
              ···
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send)"
            rows={2}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 7,
              color: '#d8d8ec',
              fontSize: 12,
              padding: '7px 9px',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            style={{
              background: sending || !input.trim() ? 'rgba(74,158,255,0.15)' : '#4a9eff',
              border: 'none',
              borderRadius: 7,
              color: sending || !input.trim() ? '#2a4a7a' : '#fff',
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              fontSize: 16,
              fontWeight: 700,
              width: 38,
              height: 50,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s',
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Shelf ────────────────────────────────────────────────────────────────────

function ShelfSection({ groups }: { groups: TabGroup[] }) {
  const [shelf, setShelf] = useState<ShelfItem[]>([]);

  useEffect(() => {
    window.electronAPI.getShelf().then(setShelf).catch(() => { /* ignore */ });
    const unsub = window.electronAPI.onShelfChanged(setShelf);
    return unsub;
  }, []);

  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? null;

  if (shelf.length === 0) {
    return <EmptyState icon="📚" text="No shelved tabs" />;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#555' }}>
        {shelf.length} shelved tab{shelf.length !== 1 ? 's' : ''}
      </div>
      {shelf.map((item) => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {item.faviconUrl
            ? <img src={item.faviconUrl} alt="" width={14} height={14} style={{ borderRadius: 2, flexShrink: 0 }} />
            : <span style={{ fontSize: 12, flexShrink: 0, color: '#555' }}>○</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title || item.url}
            </div>
            <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>
              {formatTimeAgo(item.shelvedAt)}
              {groupName(item.groupId) && (
                <span style={{ marginLeft: 6, color: '#4a9eff' }}>• {groupName(item.groupId)}</span>
              )}
            </div>
          </div>
          <button onClick={() => window.electronAPI.restoreFromShelf(item.id)} style={actionBtn}>Restore</button>
          <button onClick={() => window.electronAPI.deleteFromShelf(item.id)} style={closeBtn}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

function SessionsSection() {
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const loadSessions = useCallback(() => {
    window.electronAPI.getSessions().then(setSessions).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => { loadSessions(); }, []);

  const handleSave = async () => {
    const name = newName.trim() || `Session ${new Date().toLocaleDateString()}`;
    setSaving(true);
    await window.electronAPI.saveSession(name);
    setNewName('');
    setSaving(false);
    loadSessions();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="Session name…"
            style={inputStyle}
          />
          <button onClick={handleSave} disabled={saving} style={primaryBtn}>Save</button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sessions.length === 0
          ? <EmptyState icon="🗂" text="No saved sessions" />
          : sessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>
                  {s.tabSnapshot?.length ?? 0} tabs · {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => window.electronAPI.restoreSession(s.id)} style={actionBtn}>Restore</button>
              <button onClick={() => { window.electronAPI.deleteSession(s.id); loadSessions(); }} style={closeBtn}>✕</button>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function HistorySection() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [pots, setPots] = useState<Pot[]>([]);

  const loadHistory = useCallback((q?: string) => {
    window.electronAPI.getHistory(q, 80).then(setHistory).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    loadHistory();
    window.electronAPI.getPots().then((data: any) => setPots((data as any).pots ?? [])).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadHistory(query || undefined), 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history…"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={() => { window.electronAPI.clearHistory(); setHistory([]); }}
          style={{ background: 'transparent', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '4px 6px' }}
        >
          Clear
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {history.length === 0
          ? <EmptyState icon="🕐" text={query ? 'No matches' : 'No history yet'} />
          : history.map((h) => <HistoryRow key={h.id} entry={h} pots={pots} />)}
      </div>
    </div>
  );
}

function HistoryRow({ entry, pots }: { entry: HistoryEntry; pots: Pot[] }) {
  const [showPromote, setShowPromote] = useState(false);
  const [selectedPotId, setSelectedPotId] = useState(pots[0]?.id ?? '');
  const timeStr = new Date(entry.visitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={() => window.electronAPI.newTab(entry.url)}
            style={{ fontSize: 12, color: '#c8c8e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            {entry.title || entry.url}
          </div>
          <div style={{ fontSize: 10, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {entry.url} · {timeStr}
          </div>
        </div>
        <button onClick={() => setShowPromote((v) => !v)} title="Save to Links" style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '2px 5px' }}>
          📌
        </button>
      </div>
      {showPromote && pots.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <select
            value={selectedPotId}
            onChange={(e) => setSelectedPotId(e.target.value)}
            style={{ flex: 1, ...inputStyle }}
          >
            {pots.map((p) => <option key={p.id} value={p.id} style={{ background: '#1e1e2e' }}>{p.name}</option>)}
          </select>
          <button
            onClick={() => { window.electronAPI.promoteHistory(entry.id, selectedPotId); setShowPromote(false); }}
            style={primaryBtn}
          >
            Save
          </button>
          <button onClick={() => setShowPromote(false)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── Highlights ───────────────────────────────────────────────────────────────

function HighlightsSection() {
  const [buffer, setBuffer] = useState<HighlightBufferEntry[]>([]);
  const [pots, setPots] = useState<Pot[]>([]);
  const [selectedPotId, setSelectedPotId] = useState('');

  useEffect(() => {
    window.electronAPI.getHighlightBuffer().then(setBuffer).catch(() => { /* ignore */ });
    const unsub = window.electronAPI.onHighlightBufferChanged(setBuffer);
    window.electronAPI.getPots().then((data: any) => {
      const list: Pot[] = (data as any).pots ?? [];
      setPots(list);
      if (list.length > 0) setSelectedPotId(list[0].id);
    }).catch(() => { /* ignore */ });
    return unsub;
  }, []);

  if (buffer.length === 0) {
    return <EmptyState icon="✂" text="No highlights buffered" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#888' }}>{buffer.length} highlight{buffer.length !== 1 ? 's' : ''}</span>
        {pots.length > 0 && (
          <>
            <select
              value={selectedPotId}
              onChange={(e) => setSelectedPotId(e.target.value)}
              style={{ flex: 1, ...inputStyle }}
            >
              {pots.map((p) => <option key={p.id} value={p.id} style={{ background: '#1e1e2e' }}>{p.name}</option>)}
            </select>
            <button
              onClick={async () => {
                if (!selectedPotId) return;
                for (const h of buffer) await window.electronAPI.saveHighlight(h.id, selectedPotId);
              }}
              style={primaryBtn}
            >
              Save All
            </button>
          </>
        )}
        <button
          onClick={() => window.electronAPI.clearHighlightBuffer()}
          style={{ background: 'transparent', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '4px 6px' }}
        >
          Discard all
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {buffer.map((h) => (
          <div key={h.id} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#c8c8e0', marginBottom: 4, fontStyle: 'italic' }}>
              "{h.text.slice(0, 120)}{h.text.length > 120 ? '…' : ''}"
            </div>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.url}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => selectedPotId && window.electronAPI.saveHighlight(h.id, selectedPotId)} style={actionBtn}>Save</button>
              <button onClick={() => window.electronAPI.discardHighlight(h.id)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, padding: '3px 8px' }}>Discard</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

const privacyCfg: Record<PrivacyMode, { icon: string; label: string; desc: string; color: string }> = {
  zero:   { icon: '🔒', label: 'Zero Monitoring',         desc: 'Nothing captured without explicit action', color: '#2ecc71' },
  review: { icon: '👁', label: 'End-of-Session Review',   desc: 'Review visited pages before quitting',     color: '#f39c12' },
  full:   { icon: '⚡', label: 'Full Capture',             desc: 'Page visits auto-create link entries',     color: '#4a9eff' },
};

function PrivacySection({ currentMode, onModeChange }: { currentMode: PrivacyMode; onModeChange: (m: PrivacyMode) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await window.electronAPI.clearBrowsingData();
    } finally {
      setClearing(false);
      setConfirm(false);
    }
  };

  return (
    <div style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 12, padding: '0 4px' }}>
        Choose how much the browser captures automatically.
      </div>
      {(Object.entries(privacyCfg) as [PrivacyMode, typeof privacyCfg.zero][]).map(([key, cfg]) => (
        <button
          key={key}
          onClick={() => onModeChange(key)}
          style={{
            width: '100%',
            padding: '11px 12px',
            marginBottom: 6,
            background: currentMode === key ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
            border: currentMode === key ? `1px solid ${cfg.color}44` : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 7,
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>{cfg.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: currentMode === key ? cfg.color : '#c8c8e0', fontWeight: 600 }}>{cfg.label}</div>
            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{cfg.desc}</div>
          </div>
          {currentMode === key && <span style={{ color: cfg.color, fontSize: 14 }}>✓</span>}
        </button>
      ))}

      {/* Clear browsing data */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 8, padding: '0 4px' }}>
          Session data
        </div>
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            style={{
              width: '100%',
              padding: '9px 12px',
              background: 'rgba(231,76,60,0.08)',
              border: '1px solid rgba(231,76,60,0.2)',
              borderRadius: 7,
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }}>🗑</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#e74c3c', fontWeight: 600 }}>Clear browsing data</div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Wipes cookies, cache, storage — logs out everywhere</div>
            </div>
          </button>
        ) : (
          <div style={{ padding: '10px 12px', background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.25)', borderRadius: 7 }}>
            <div style={{ fontSize: 12, color: '#e8d0d0', marginBottom: 10 }}>
              This will delete all cookies and cached data. You will be logged out of every site.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleClear}
                disabled={clearing}
                style={{ background: '#e74c3c', border: 'none', borderRadius: 5, color: '#fff', cursor: clearing ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px', opacity: clearing ? 0.6 : 1 }}
              >
                {clearing ? 'Clearing…' : 'Clear now'}
              </button>
              <button
                onClick={() => setConfirm(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#888', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10, color: '#3a3a5a', fontSize: 13, padding: 24, textAlign: 'center' }}>
      <span style={{ fontSize: 28, opacity: 0.35 }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const toolBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(74,158,255,0.15)' : 'transparent',
  border: 'none',
  borderRadius: 5,
  color: active ? '#4a9eff' : '#888',
  cursor: 'pointer',
  fontSize: 11,
  padding: '4px 8px',
  lineHeight: 1,
});

const actionBtn: React.CSSProperties = {
  background: 'rgba(74,158,255,0.15)',
  border: 'none',
  color: '#4a9eff',
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
  flexShrink: 0,
};

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#555',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 5px',
  borderRadius: 4,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  color: '#e8e8f0',
  fontSize: 12,
  padding: '5px 8px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#4a9eff',
  border: 'none',
  color: '#fff',
  padding: '5px 10px',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
  flexShrink: 0,
};
