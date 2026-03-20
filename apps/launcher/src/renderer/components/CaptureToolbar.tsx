/**
 * CaptureToolbar — Phase E
 * Save page / selection buttons with custom icons.
 */
import React from 'react';
import savePageIcon      from '../assets/icons/save_page.png';
import saveSelectionIcon from '../assets/icons/save_selection.png';
import type { TabState } from '../../shared/types.js';

interface Props {
  activeTab: TabState | null;
  onShowCapturePicker: (type: 'page' | 'selection') => void;
}

function CaptureBtn({
  title,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        border: 'none',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        WebkitAppRegion: 'no-drag' as never,
        transition: 'background 0.15s, opacity 0.15s',
        opacity: disabled ? 0.25 : 0.8,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.background = 'rgba(74,158,255,0.18)';
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.opacity = disabled ? '0.25' : '0.8';
      }}
    >
      <img src={icon} alt={title} width={20} height={20} style={{ objectFit: 'contain', display: 'block' }} />
    </button>
  );
}

export function CaptureToolbar({ activeTab, onShowCapturePicker }: Props) {
  const isWebTab = activeTab?.type === 'web';

  return (
    <div style={{ display: 'flex', gap: 1, WebkitAppRegion: 'no-drag' as never }}>
      <CaptureBtn
        title="Save page to Links (Ctrl+Shift+S)"
        icon={savePageIcon}
        disabled={!isWebTab}
        onClick={() => onShowCapturePicker('page')}
      />
      <CaptureBtn
        title="Save selection to Links"
        icon={saveSelectionIcon}
        disabled={!isWebTab}
        onClick={() => onShowCapturePicker('selection')}
      />
    </div>
  );
}
