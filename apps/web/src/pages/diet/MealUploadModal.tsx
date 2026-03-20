import { useState, useRef } from 'react';
import { api } from '@/lib/api';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

interface Props {
  defaultMealType: MealType;
  onClose: () => void;
  onSuccess: () => void;
}

export function MealUploadModal({ defaultMealType, onClose, onSuccess }: Props) {
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [mealDate, setMealDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [userNote, setUserNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Please select an image of your meal.');
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('meal_date', mealDate);
      formData.append('meal_type', mealType);
      if (userNote) formData.append('user_note', userNote);

      await api.upload('/nutrition/meals', formData);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Log Meal</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="meal-upload-form">
          <div className="form-row">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="form-input"
              value={mealDate}
              onChange={(e) => setMealDate(e.target.value)}
            />
          </div>

          <div className="form-row">
            <label className="form-label">Meal Type</label>
            <select
              className="form-input"
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
            >
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </select>
          </div>

          <div
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Meal preview" className="drop-zone__preview" />
            ) : (
              <div className="drop-zone__placeholder">
                <span>Drop photo here or click to select</span>
                <small>JPEG, PNG, WEBP</small>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <div className="form-row">
            <label className="form-label">Note (optional)</label>
            <textarea
              className="form-input"
              rows={2}
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="Any notes about this meal…"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={uploading || !file}>
              {uploading ? 'Uploading…' : 'Log Meal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
