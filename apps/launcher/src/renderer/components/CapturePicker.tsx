/**
 * CapturePicker — Phase E
 * Modal for selecting a pot when saving content.
 */
import React, { useState, useEffect } from 'react';
import type { CapturePickerOptions } from '../../shared/types.js';

interface Pot {
  id: string;
  name: string;
}

interface Props {
  opts: CapturePickerOptions;
  onClose: () => void;
  onSaved: () => void;
}

export function CapturePicker({ opts, onClose, onSaved }: Props) {
  const [pots, setPots] = useState<Pot[]>([]);
  const [selectedPotId, setSelectedPotId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI
      .getPots()
      .then((data) => {
        const list: Pot[] = (data as any).pots ?? (Array.isArray(data) ? data : []);
        setPots(list);
        if (list.length > 0) setSelectedPotId(list[0].id);
      })
      .catch(() => setPots([]));
  }, []);

  const typeLabel: Record<CapturePickerOptions['type'], string> = {
    page: 'Save Page',
    selection: 'Save Selection',
    image: 'Save Image',
  };

  const handleSave = async () => {
    if (!selectedPotId) return;
    setSaving(true);
    setError(null);
    try {
      if (opts.type === 'selection') {
        await window.electronAPI.captureSelection(opts.tabId, selectedPotId, notes || undefined);
      } else if (opts.type === 'page') {
        await window.electronAPI.capturePage(opts.tabId, selectedPotId, notes || undefined);
      } else if (opts.type === 'image') {
        if (!opts.payload) throw new Error('No image URL provided');
        await window.electronAPI.captureImage(opts.tabId, opts.payload, selectedPotId, notes || undefined);
      }
      onSaved();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          backdropFilter: 'blur(4px)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201,
          background: '#1e1e2e',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          padding: 20,
          width: 360,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{ fontSize: 15, fontWeight: 600, color: '#e8e8f0', marginBottom: 16 }}
        >
          {typeLabel[opts.type]}
        </div>

        {/* Pot selector */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{ fontSize: 11, color: '#888', marginBottom: 5, display: 'block' }}
          >
            Save to pot
          </label>
          {pots.length === 0 ? (
            <div style={{ color: '#666', fontSize: 12 }}>Loading pots…</div>
          ) : (
            <select
              value={selectedPotId}
              onChange={(e) => setSelectedPotId(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#e8e8f0',
                padding: '7px 10px',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {pots.map((p) => (
                <option key={p.id} value={p.id} style={{ background: '#1e1e2e' }}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: '#888', marginBottom: 5, display: 'block' }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why are you saving this?"
            rows={2}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: '#e8e8f0',
              padding: '7px 10px',
              fontSize: 13,
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {error && (
          <div
            style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#aaa',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedPotId}
            style={{
              background: saving ? 'rgba(74,158,255,0.4)' : '#4a9eff',
              border: 'none',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: saving ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
