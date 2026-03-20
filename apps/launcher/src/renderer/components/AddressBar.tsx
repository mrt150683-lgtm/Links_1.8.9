/**
 * AddressBar — URL input with favicon display.
 * Disabled when the Links App tab is active.
 */
import React, { useState, useEffect, useRef } from 'react';
import type { TabState } from '../../shared/types.js';

interface Props {
  activeTab: TabState | null;
}

function resolveUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(t)) return t; // other protocols
  // Looks like a domain: has a dot, no spaces, not starting with a dot
  if (!t.includes(' ') && t.includes('.') && !/^\./i.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

export function AddressBar({ activeTab }: Props) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isLinksApp = activeTab?.type === 'links_app';
  const displayUrl = activeTab?.url ?? '';

  useEffect(() => {
    if (!isFocused) {
      setInputValue(displayUrl);
    }
  }, [displayUrl, isFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTab || isLinksApp) return;
    const val = inputValue.trim();
    if (!val) return;
    window.electronAPI.navigate(activeTab.id, resolveUrl(val));
    inputRef.current?.blur();
  };

  const handleFocus = () => {
    setIsFocused(true);
    inputRef.current?.select();
  };

  const handleBlur = () => {
    setIsFocused(false);
    setInputValue(displayUrl);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(255,255,255,0.06)',
        border: isFocused ? '1px solid rgba(74,158,255,0.6)' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        padding: '0 8px',
        height: 32,
        minWidth: 0,
        WebkitAppRegion: 'no-drag' as never,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Favicon */}
      {activeTab?.faviconUrl && !isLinksApp ? (
        <img
          src={activeTab.faviconUrl}
          alt=""
          width={14}
          height={14}
          style={{ flexShrink: 0, borderRadius: 2, objectFit: 'contain' }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span style={{ fontSize: 12, color: '#4a9eff', flexShrink: 0 }}>🔗</span>
      )}

      <input
        ref={inputRef}
        type="text"
        value={isFocused ? inputValue : (isLinksApp ? 'Links — Research Dashboard' : inputValue)}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        readOnly={isLinksApp}
        placeholder="Search or enter URL…"
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: isLinksApp ? '#888' : '#e8e8f0',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: isLinksApp ? 'default' : 'text',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      />
    </form>
  );
}
