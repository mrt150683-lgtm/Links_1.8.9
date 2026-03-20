import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface PotRoleData {
  role_ref: string | null;
  source: 'user' | 'builtin' | 'default';
  text: string;
  hash: string;
  updated_at: number | null;
  lint_warnings: string[];
}

interface PotRoleModalProps {
  potId: string;
  onClose: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  user: 'Custom',
  builtin: 'Builtin',
  default: 'Default',
};

export function PotRoleModal({ potId, onClose }: PotRoleModalProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: roleData, isLoading } = useQuery({
    queryKey: ['pot-role', potId],
    queryFn: () => api.get<PotRoleData>(`/pots/${potId}/role`),
  });

  useEffect(() => {
    if (roleData) {
      setText(roleData.text);
    }
  }, [roleData]);

  const saveMutation = useMutation({
    mutationFn: (roleText: string) =>
      api.put<PotRoleData>(`/pots/${potId}/role`, { text: roleText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pot-role', potId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => {
    saveMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Agent Role"
    >
      <div className="modal-content" style={{ maxWidth: '680px', width: '100%' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Agent Role</h2>
          <button
            className="btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '24px' }}>
            <div className="skeleton" style={{ height: '120px' }} />
          </div>
        ) : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {roleData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span
                  style={{
                    background: roleData.source === 'default' ? 'var(--surface-2)' : 'var(--accent-muted)',
                    color: roleData.source === 'default' ? 'var(--text-muted)' : 'var(--accent)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                  }}
                >
                  {SOURCE_LABELS[roleData.source] ?? roleData.source}
                </span>
                {roleData.hash && (
                  <span title={`Role hash: ${roleData.hash}`}>
                    #{roleData.hash.slice(0, 8)}
                  </span>
                )}
                {roleData.updated_at && (
                  <span>
                    Updated {new Date(roleData.updated_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500 }}>
                Role instructions
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={16}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.82rem',
                  lineHeight: '1.5',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  padding: '10px',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                }}
                placeholder="Describe the AI's role for this pot. Use markdown headings like ## Goals, ## Do, ## Don't."
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>{text.length} / 12000 characters</span>
                {text.length > 12000 && (
                  <span style={{ color: 'var(--danger)' }}>Exceeds limit — save will fail</span>
                )}
              </div>
            </div>

            {roleData?.lint_warnings && roleData.lint_warnings.length > 0 && (
              <div style={{ background: 'var(--warning-muted)', border: '1px solid var(--warning)', borderRadius: '6px', padding: '10px 14px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '6px' }}>Suggestions</div>
                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8rem', lineHeight: '1.6' }}>
                  {roleData.lint_warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {saveMutation.isError && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                {(saveMutation.error as Error)?.message ?? 'Save failed'}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={saveMutation.isPending || text.length > 12000}
              >
                {saveMutation.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Role'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
