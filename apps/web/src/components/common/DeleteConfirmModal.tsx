import { useState } from 'react';
import './DeleteConfirmModal.css';

export interface DeleteConsequence {
  label: string;
  count: number;
  warning?: boolean;
}

interface DeleteConfirmModalProps {
  title: string;
  itemName: string;
  itemType: 'pot' | 'entry' | 'asset';
  consequences?: DeleteConsequence[];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isDeleting?: boolean;
}

export function DeleteConfirmModal({
  title,
  itemName,
  itemType,
  consequences,
  onConfirm,
  onCancel,
  isDeleting = false,
}: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const requiresTypeConfirm = consequences && consequences.length > 0;
  const confirmWord = itemType.toUpperCase();
  const canConfirm = !requiresTypeConfirm || confirmText === confirmWord;

  const handleConfirm = async () => {
    if (canConfirm) {
      await onConfirm();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal panel delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="delete-modal__icon">⚠️</div>
          <h2>{title}</h2>
        </div>

        <div className="delete-modal__content">
          <div className="delete-modal__item">
            <strong>{itemName}</strong>
          </div>

          {consequences && consequences.length > 0 && (
            <div className="delete-modal__consequences">
              <p className="delete-modal__warning">
                This action will also remove:
              </p>
              <ul className="delete-modal__list">
                {consequences.map((consequence, index) => (
                  <li
                    key={index}
                    className={consequence.warning ? 'delete-modal__list-item--warning' : ''}
                  >
                    <strong>{consequence.count}</strong> {consequence.label}
                    {consequence.count !== 1 && 's'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="delete-modal__danger-zone">
            <p className="delete-modal__danger-text">
              ⚠️ This action <strong>cannot be undone</strong>. All data will be permanently deleted.
            </p>

            {requiresTypeConfirm && (
              <div className="form-field">
                <label htmlFor="confirm-text">
                  Type <strong>{confirmWord}</strong> to confirm:
                </label>
                <input
                  id="confirm-text"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={confirmWord}
                  autoFocus
                  disabled={isDeleting}
                />
              </div>
            )}
          </div>
        </div>

        <div className="modal__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleConfirm}
            disabled={!canConfirm || isDeleting}
          >
            {isDeleting ? 'Deleting...' : `Delete ${itemType}`}
          </button>
        </div>
      </div>
    </div>
  );
}
