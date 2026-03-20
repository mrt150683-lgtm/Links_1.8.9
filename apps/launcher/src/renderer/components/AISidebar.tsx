/**
 * AISidebar — Browser AI Chat (Phase G replacement)
 *
 * Minimal in-renderer chat panel. Replaces the WebContentsView-based sidebar
 * that loaded the full chat app. Calls the main-chat API directly via fetch().
 *
 * Rendered in the chrome renderer's DOM, positioned in the 360px right space
 * vacated by setRightInset(360). No z-index issues.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = 'http://127.0.0.1:3000';
const CHROME_HEIGHT = 80;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PageCtx {
  url: string;
  title: string;
  text: string;
}

interface Props {
  onClose: () => void;
}

export function AISidebar({ onClose }: Props) {
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

    // Prepend page context to first message if loaded
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
        body: JSON.stringify({
          content: fullContent,
          thread_id: threadId ?? undefined,
        }),
      });
      const data = await res.json() as { thread_id?: string; assistant_message?: { content: string } };
      if (data.thread_id) setThreadId(data.thread_id);
      if (data.assistant_message?.content) {
        setMessages((msgs) => [
          ...msgs,
          { role: 'assistant', content: data.assistant_message!.content },
        ]);
      }
    } catch {
      setMessages((msgs) => [
        ...msgs,
        { role: 'assistant', content: 'Could not reach the Links API. Make sure the app is running.' },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, sending, threadId, pageCtx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

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
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          height: 44,
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#4a9eff', fontSize: 15 }}>✦</span>
        <span style={{ color: '#d0d0e8', fontSize: 13, fontWeight: 600, flex: 1 }}>
          Browser AI
        </span>
        <button
          onClick={handleLoadPageContext}
          disabled={loadingCtx}
          title="Inject current page into chat"
          style={toolBtn(!!pageCtx)}
        >
          {loadingCtx ? '…' : '📄'}
        </button>
        <button
          onClick={handleNewConversation}
          title="New conversation"
          style={toolBtn(false)}
        >
          ↺
        </button>
        <button
          onClick={onClose}
          title="Close sidebar"
          style={{ ...toolBtn(false), color: '#666' }}
        >
          ✕
        </button>
      </div>

      {/* Page context banner */}
      {pageCtx && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'rgba(74,158,255,0.08)',
            borderBottom: '1px solid rgba(74,158,255,0.12)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, color: '#4a9eff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {pageCtx.title || pageCtx.url}
          </span>
          <button
            onClick={() => setPageCtx(null)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#3a3a5a', fontSize: 12, textAlign: 'center', marginTop: 32, lineHeight: 1.6 }}>
            Ask anything — or click 📄 to chat<br />about the page you're reading.
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '88%',
                padding: '8px 11px',
                borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: msg.role === 'user'
                  ? 'rgba(74,158,255,0.14)'
                  : 'rgba(255,255,255,0.05)',
                border: msg.role === 'user'
                  ? '1px solid rgba(74,158,255,0.18)'
                  : '1px solid rgba(255,255,255,0.06)',
                fontSize: 13,
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
            <div
              style={{
                padding: '8px 11px',
                borderRadius: '12px 12px 12px 3px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.06)',
                fontSize: 13,
                color: '#4a4a6a',
              }}
            >
              ···
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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
              borderRadius: 8,
              color: '#d8d8ec',
              fontSize: 13,
              padding: '8px 10px',
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
              borderRadius: 8,
              color: sending || !input.trim() ? '#2a4a7a' : '#fff',
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              fontSize: 16,
              fontWeight: 700,
              width: 40,
              height: 52,
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
    </div>
  );
}

function toolBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(74,158,255,0.15)' : 'transparent',
    border: 'none',
    borderRadius: 5,
    color: active ? '#4a9eff' : '#666',
    cursor: 'pointer',
    fontSize: 14,
    padding: '4px 7px',
    lineHeight: 1,
    transition: 'background 0.1s, color 0.1s',
  };
}
