import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { Pot, Entry } from '@/lib/types';
import { DeleteConfirmModal, type DeleteConsequence } from '@/components/common/DeleteConfirmModal';
import potsIcon from '@/assets/icons/pots.png?url';
import exportIcon from '@/assets/icons/Export.png?url';
import './Pots.css';

export function PotsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [potToDelete, setPotToDelete] = useState<Pot | null>(null);
  const [potToExport, setPotToExport] = useState<Pot | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: potsData, isLoading } = useQuery({
    queryKey: ['pots'],
    queryFn: () => api.get<{ pots: Pot[]; total: number }>('/pots'),
  });

  const pots = potsData?.pots ?? [];

  // Fetch entries/assets for the pot to delete (for consequences preview)
  const { data: entriesData } = useQuery({
    queryKey: ['pot-entries', potToDelete?.id],
    queryFn: () => api.get<{ entries: Entry[]; total: number }>(`/pots/${potToDelete!.id}/entries`),
    enabled: !!potToDelete,
  });

  const { data: assetsData } = useQuery({
    queryKey: ['pot-assets', potToDelete?.id],
    queryFn: () => api.get<{ assets: Array<{ id: string }>; total: number }>(`/pots/${potToDelete!.id}/assets`),
    enabled: !!potToDelete,
  });

  const deletePot = useMutation({
    mutationFn: (potId: string) => api.delete(`/pots/${potId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pots'] });
      setPotToDelete(null);
    },
  });

  const handleDeleteConfirm = async () => {
    if (potToDelete) {
      await deletePot.mutateAsync(potToDelete.id);
    }
  };

  const consequences: DeleteConsequence[] = [];
  if (potToDelete) {
    const entriesCount = entriesData?.total ?? 0;
    const assetsCount = assetsData?.total ?? 0;

    if (entriesCount > 0) {
      consequences.push({ label: 'entry', count: entriesCount, warning: true });
    }
    if (assetsCount > 0) {
      consequences.push({ label: 'asset', count: assetsCount, warning: true });
    }
  }

  const filteredPots = pots?.filter((pot) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      pot.name.toLowerCase().includes(query) ||
      pot.description?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="pots-page">
      <div className="pots-page__header">
        <h1>Pots</h1>
        <div className="pots-page__header-actions">
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            📥 Import Pot
          </button>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create Pot
          </button>
        </div>
      </div>

      <div className="pots-page__controls">
        <input
          type="text"
          className="pots-page__search"
          placeholder="🔍 Search pots..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="pots-page__loading">
          <div className="skeleton" style={{ height: '200px', borderRadius: '16px' }} />
          <div className="skeleton" style={{ height: '200px', borderRadius: '16px' }} />
          <div className="skeleton" style={{ height: '200px', borderRadius: '16px' }} />
        </div>
      ) : filteredPots.length > 0 ? (
        <div className="pots-grid">
          {filteredPots.map((pot) => (
            <PotCard
              key={pot.id}
              pot={pot}
              onOpen={() => navigate(`/pots/${pot.id}`)}
              onDelete={() => setPotToDelete(pot)}
              onExport={() => setPotToExport(pot)}
            />
          ))}
        </div>
      ) : (
        <div className="pots-page__empty">
          <div className="icon-badge">🗂️</div>
          <h2>No pots yet</h2>
          <p className="text-muted">Create your first research pot to start capturing</p>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create Pot
          </button>
        </div>
      )}

      {showCreateModal && <CreatePotModal onClose={() => setShowCreateModal(false)} />}

      {potToDelete && (
        <DeleteConfirmModal
          title="Delete Pot"
          itemName={potToDelete.name}
          itemType="pot"
          consequences={consequences}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPotToDelete(null)}
          isDeleting={deletePot.isPending}
        />
      )}

      {potToExport && <ExportPotModal pot={potToExport} onClose={() => setPotToExport(null)} />}

      {showImportModal && <ImportPotModal onClose={() => setShowImportModal(false)} />}
    </div>
  );
}

interface PotCardProps {
  pot: Pot;
  onOpen: () => void;
  onDelete: () => void;
  onExport: () => void;
}

function PotCard({ pot, onOpen, onDelete, onExport }: PotCardProps) {
  const lastUsed = new Date(pot.last_used_at).toLocaleDateString();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExport();
  };

  return (
    <div className="pot-card panel" onClick={onOpen}>
      <div className="pot-card__header">
        <img src={potsIcon} alt="Pot" className="pot-card__icon-img" />
        <div className="pot-card__title-section">
          <h3 className="pot-card__title">{pot.name}</h3>
          {pot.description && <p className="pot-card__description">{pot.description}</p>}
        </div>
        <div className="pot-card__actions">
          <button
            className="pot-card__export btn-ghost"
            onClick={handleExport}
            title="Export pot"
          >
            <img src={exportIcon} alt="Export" style={{ width: 16, height: 16, objectFit: 'contain' }} />
          </button>
          <button
            className="pot-card__delete btn-ghost"
            onClick={handleDelete}
            title="Delete pot"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="pot-card__footer">
        <span className="pot-card__meta text-muted">Last used: {lastUsed}</span>
      </div>
    </div>
  );
}

interface CreatePotModalProps {
  onClose: () => void;
}

function CreatePotModal({ onClose }: CreatePotModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconEmoji, setIconEmoji] = useState('🗂️');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const createPot = useMutation({
    mutationFn: (data: { name: string; description?: string; icon_emoji?: string }) =>
      api.post<Pot>('/pots', data),
    onSuccess: (pot) => {
      queryClient.invalidateQueries({ queryKey: ['pots'] });
      onClose();
      navigate(`/pots/${pot.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      createPot.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        icon_emoji: iconEmoji,
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Create Pot</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal__form">
          <div className="form-field">
            <label htmlFor="name">Name *</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Research Pot"
              required
              autoFocus
            />
          </div>

          <div className="form-field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
            />
          </div>

          <div className="form-field">
            <label htmlFor="icon">Icon</label>
            <input
              id="icon"
              type="text"
              value={iconEmoji}
              onChange={(e) => setIconEmoji(e.target.value)}
              placeholder="🗂️"
              maxLength={2}
            />
          </div>

          <div className="modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || createPot.isPending}>
              {createPot.isPending ? 'Creating...' : 'Create Pot'}
            </button>
          </div>

          {createPot.isError && (
            <div className="modal__error">
              Failed to create pot. Please try again.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

interface ExportPotModalProps {
  pot: Pot;
  onClose: () => void;
}

function ExportPotModal({ pot, onClose }: ExportPotModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [mode, setMode] = useState<'private' | 'public'>('private');
  const [bundleName, setBundleName] = useState('');
  const [result, setResult] = useState<{ bundle_path: string; bundle_sha256: string } | null>(null);

  const exportPot = useMutation({
    mutationFn: (data: {
      mode: 'private' | 'public';
      passphrase: string;
      bundle_name?: string;
    }) =>
      api.post<{ ok: boolean; bundle_path: string; bundle_sha256: string }>(
        `/pots/${pot.id}/export`,
        data
      ),
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const isPasswordValid = passphrase.length >= 8 && passphrase === confirmPassphrase;
  const canSubmit = isPasswordValid && !exportPot.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      exportPot.mutate({
        mode,
        passphrase,
        bundle_name: bundleName.trim() || undefined,
      });
    }
  };

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <h2>Export Successful</h2>
            <button className="btn-ghost" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="modal__form">
            <div className="settings-message--success" style={{ padding: 'var(--space-3)', borderRadius: 'var(--r-input)' }}>
              <p style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
                <strong>✓ Export complete</strong>
              </p>
              <p style={{ margin: 0, fontSize: '12px', marginBottom: 'var(--space-2)' }}>
                <strong>Path:</strong> {result.bundle_path}
              </p>
              <p style={{ margin: 0, fontSize: '12px', wordBreak: 'break-all' }}>
                <strong>SHA-256:</strong> {result.bundle_sha256}
              </p>
            </div>

            <div className="modal__actions">
              <button type="button" className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Export "{pot.name}"</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal__form">
          <div className="form-field">
            <label htmlFor="export-passphrase">Passphrase *</label>
            <input
              id="export-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              autoFocus
            />
            {passphrase && passphrase.length < 8 && (
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--danger)' }}>
                At least 8 characters required
              </p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="export-confirm">Confirm Passphrase *</label>
            <input
              id="export-confirm"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Repeat passphrase"
              autoComplete="new-password"
            />
            {confirmPassphrase && passphrase !== confirmPassphrase && (
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--danger)' }}>
                Passphrases do not match
              </p>
            )}
          </div>

          <div className="form-field">
            <label>Export Mode *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontWeight: 400 }}>
                <input
                  type="radio"
                  name="mode"
                  value="private"
                  checked={mode === 'private'}
                  onChange={(e) => setMode(e.target.value as 'private' | 'public')}
                />
                <span>
                  <strong>Private</strong> — Include all metadata (recommended for personal backups)
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontWeight: 400 }}>
                <input
                  type="radio"
                  name="mode"
                  value="public"
                  checked={mode === 'public'}
                  onChange={(e) => setMode(e.target.value as 'private' | 'public')}
                />
                <span>
                  <strong>Public</strong> — Strip source URLs and notes (for sharing without revealing research methods)
                </span>
              </label>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="bundle-name">Bundle Name (optional)</label>
            <input
              id="bundle-name"
              type="text"
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              placeholder="e.g. research_backup_feb2026"
            />
          </div>

          {exportPot.isPending && (
            <div className="skeleton" style={{ height: '8px' }} />
          )}

          <div className="modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={exportPot.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {exportPot.isPending ? 'Exporting...' : 'Export'}
            </button>
          </div>

          {exportPot.isError && (
            <div className="modal__error">
              {exportPot.error instanceof Error ? exportPot.error.message : 'Failed to export pot. Please try again.'}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

interface ImportPotModalProps {
  onClose: () => void;
}

function ImportPotModal({ onClose }: ImportPotModalProps) {
  const [bundlePath, setBundlePath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [importAsName, setImportAsName] = useState('');
  const [result, setResult] = useState<{ pot_id: string; stats: Record<string, number> } | null>(null);
  const queryClient = useQueryClient();

  const importPot = useMutation({
    mutationFn: (data: { bundle_path: string; passphrase: string; import_as_name?: string }) =>
      api.post<{ ok: boolean; pot_id: string; stats: Record<string, number> }>('/pots/import', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pots'] });
      setResult(data);
    },
  });

  const canSubmit = bundlePath.trim() && passphrase && !importPot.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      importPot.mutate({
        bundle_path: bundlePath.trim(),
        passphrase,
        import_as_name: importAsName.trim() || undefined,
      });
    }
  };

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <h2>Import Successful</h2>
            <button className="btn-ghost" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="modal__form">
            <div className="settings-message--success" style={{ padding: 'var(--space-3)', borderRadius: 'var(--r-input)' }}>
              <p style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
                <strong>✓ Pot imported successfully</strong>
              </p>
              <div style={{ fontSize: '12px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {Object.entries(result.stats).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <strong>{key}:</strong>
                    <span>{value}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="modal__actions">
              <button type="button" className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Import Pot</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal__form">
          <div className="form-field">
            <label htmlFor="bundle-path">Bundle Path *</label>
            <input
              id="bundle-path"
              type="text"
              value={bundlePath}
              onChange={(e) => setBundlePath(e.target.value)}
              placeholder="e.g. C:\Users\...\exports\pot_name_2026-02-18.lynxpot"
              autoFocus
            />
          </div>

          <div className="form-field">
            <label htmlFor="import-passphrase">Passphrase *</label>
            <input
              id="import-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter the passphrase used during export"
              autoComplete="off"
            />
          </div>

          <div className="form-field">
            <label htmlFor="import-as-name">Import as Name (optional)</label>
            <input
              id="import-as-name"
              type="text"
              value={importAsName}
              onChange={(e) => setImportAsName(e.target.value)}
              placeholder="Leave blank to keep original name"
            />
          </div>

          {importPot.isPending && (
            <div className="skeleton" style={{ height: '8px' }} />
          )}

          <div className="modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={importPot.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {importPot.isPending ? 'Importing...' : 'Import'}
            </button>
          </div>

          {importPot.isError && (
            <div className="modal__error">
              {importPot.error instanceof Error ? importPot.error.message : 'Failed to import pot. Please check the path and passphrase.'}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
