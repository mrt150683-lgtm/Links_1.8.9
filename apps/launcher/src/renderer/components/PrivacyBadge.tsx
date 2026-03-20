/**
 * PrivacyBadge — Phase I
 * Shows current privacy mode and allows switching.
 */
import React, { useState, useEffect } from 'react';
import type { PrivacyMode } from '../../shared/types.js';

interface Props {
  mode: PrivacyMode;
  onModeChange: (mode: PrivacyMode) => void;
}

const modeConfig: Record<PrivacyMode, { icon: string; label: string; color: string }> = {
  zero: { icon: '🔒', label: 'Zero Monitoring', color: '#2ecc71' },
  review: { icon: '👁', label: 'End-of-Session Review', color: '#f39c12' },
  full: { icon: '⚡', label: 'Full Capture', color: '#4a9eff' },
};

const PANEL_INSET = 200; // privacy dropdown is smaller

export function PrivacyBadge({ mode, onModeChange }: Props) {
  const [open, setOpen] = useState(false);
  const cfg = modeConfig[mode];

  useEffect(() => {
    window.electronAPI.setTopInset(open ? PANEL_INSET : 0).catch(() => { /* ignore */ });
    return () => { if (open) window.electronAPI.setTopInset(0).catch(() => { /* ignore */ }); };
  }, [open]);

  return (
    <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as never }}>
      <button
        title={`Privacy: ${cfg.label}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          padding: '4px 6px',
          borderRadius: 4,
          color: cfg.color,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {cfg.icon}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 100,
              background: '#1e1e2e',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              overflow: 'hidden',
              minWidth: 200,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {(Object.entries(modeConfig) as [PrivacyMode, typeof cfg][]).map(([key, c]) => (
              <button
                key={key}
                onClick={() => { onModeChange(key); setOpen(false); }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: mode === key ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none',
                  color: c.color,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{c.icon}</span>
                <span style={{ color: '#e8e8f0' }}>{c.label}</span>
                {mode === key && <span style={{ marginLeft: 'auto', color: '#4a9eff' }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
