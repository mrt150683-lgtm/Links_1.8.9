import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Supplement {
  id: string;
  name: string;
  default_dose: number | null;
  dose_unit: string | null;
  notes: string | null;
  is_active: boolean;
}

interface SupplementEntry {
  id: string;
  supplement_id: string;
  entry_date: string;
  dose: number | null;
  dose_unit: string | null;
  meal_type: string | null;
  notes: string | null;
}

const DOSE_UNITS = ['mg', 'g', 'IU', 'mcg', 'ml', 'capsules', 'drops'] as const;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplementsTab({ potId: _potId }: { potId: string }) {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [selectedSuppId, setSelectedSuppId] = useState('');
  const [entryDose, setEntryDose] = useState('');
  const [entryUnit, setEntryUnit] = useState('');
  const [showAddCatalog, setShowAddCatalog] = useState(false);
  const [editingSupp, setEditingSupp] = useState<Supplement | null>(null);
  const [newSupp, setNewSupp] = useState({ name: '', default_dose: '', dose_unit: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: supplementsData, isLoading: suppsLoading } = useQuery({
    queryKey: ['nutrition', 'supplements'],
    queryFn: () => api.get<{ supplements: Supplement[] }>('/nutrition/supplements'),
    staleTime: 30_000,
  });

  const { data: entriesData } = useQuery({
    queryKey: ['nutrition', 'supplement-entries', selectedDate],
    queryFn: () => api.get<{ entries: SupplementEntry[] }>(`/nutrition/supplements/entries?date=${selectedDate}`),
    staleTime: 30_000,
  });

  const supplements = supplementsData?.supplements ?? [];
  const entries = entriesData?.entries ?? [];
  const activeSupplements = supplements.filter((s) => s.is_active);

  async function logEntry() {
    if (!selectedSuppId) return;
    const supp = supplements.find((s) => s.id === selectedSuppId);
    await api.post('/nutrition/supplements/entries', {
      supplement_id: selectedSuppId,
      entry_date: selectedDate,
      dose: entryDose ? Number(entryDose) : supp?.default_dose ?? undefined,
      dose_unit: entryUnit || supp?.dose_unit || undefined,
    });
    setEntryDose('');
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplement-entries', selectedDate] });
  }

  async function deleteEntry(id: string) {
    await api.delete(`/nutrition/supplements/entries/${id}`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplement-entries', selectedDate] });
  }

  async function saveCatalogItem() {
    if (!newSupp.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/nutrition/supplements', {
        name: newSupp.name.trim(),
        default_dose: newSupp.default_dose ? Number(newSupp.default_dose) : undefined,
        dose_unit: newSupp.dose_unit || undefined,
        notes: newSupp.notes || undefined,
      });
      setNewSupp({ name: '', default_dose: '', dose_unit: '', notes: '' });
      setShowAddCatalog(false);
      qc.invalidateQueries({ queryKey: ['nutrition', 'supplements'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function updateCatalogItem() {
    if (!editingSupp) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/nutrition/supplements/${editingSupp.id}`, {
        name: editingSupp.name,
        default_dose: editingSupp.default_dose,
        dose_unit: editingSupp.dose_unit,
        notes: editingSupp.notes,
      });
      setEditingSupp(null);
      qc.invalidateQueries({ queryKey: ['nutrition', 'supplements'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this supplement? It will be hidden from the log but not deleted.')) return;
    await api.delete(`/nutrition/supplements/${id}`);
    qc.invalidateQueries({ queryKey: ['nutrition', 'supplements'] });
  }

  function getSuppName(id: string) {
    return supplements.find((s) => s.id === id)?.name ?? 'Unknown';
  }

  return (
    <div className="supplements-tab">
      <h2>Supplements</h2>

      {/* ── Today's Stack ─────────────────────────────────────────── */}
      <section className="supplements-section">
        <h3>Daily Log</h3>
        <div className="form-row">
          <label className="form-label">Date</label>
          <input
            className="form-input form-input--sm"
            type="date"
            value={selectedDate}
            max={todayKey()}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <div className="supplements-log-row">
          <select
            className="form-input form-input--sm"
            value={selectedSuppId}
            onChange={(e) => {
              setSelectedSuppId(e.target.value);
              const s = supplements.find((x) => x.id === e.target.value);
              setEntryDose(s?.default_dose != null ? String(s.default_dose) : '');
              setEntryUnit(s?.dose_unit ?? '');
            }}
          >
            <option value="">Select supplement…</option>
            {activeSupplements.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            className="form-input form-input--sm"
            type="number"
            step="any"
            placeholder="dose"
            style={{ width: 80 }}
            value={entryDose}
            onChange={(e) => setEntryDose(e.target.value)}
          />
          <select
            className="form-input form-input--sm"
            value={entryUnit}
            onChange={(e) => setEntryUnit(e.target.value)}
            style={{ width: 110 }}
          >
            <option value="">unit…</option>
            {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button className="btn btn--sm btn--primary" onClick={logEntry} disabled={!selectedSuppId}>
            + Log
          </button>
        </div>

        <div className="suppentries">
          {entries.length === 0 && (
            <p className="tab-empty">No supplements logged for {selectedDate}.</p>
          )}
          {entries.map((e) => (
            <span key={e.id} className="supp-pill">
              {getSuppName(e.supplement_id)}
              {e.dose ? ` ${e.dose}${e.dose_unit ?? ''}` : ''}
              <button className="supp-pill__remove" onClick={() => deleteEntry(e.id)}>✕</button>
            </span>
          ))}
        </div>
      </section>

      {/* ── Supplement Catalog ────────────────────────────────────── */}
      <section className="supplements-section">
        <div className="supplements-section__header">
          <h3>My Supplements</h3>
          <button className="btn btn--sm" onClick={() => setShowAddCatalog((o) => !o)}>
            {showAddCatalog ? 'Cancel' : '+ Add new'}
          </button>
        </div>

        {showAddCatalog && (
          <div className="catalog-add-form">
            <input
              className="form-input form-input--sm"
              placeholder="Name (e.g. Vitamin D3)"
              value={newSupp.name}
              onChange={(e) => setNewSupp((p) => ({ ...p, name: e.target.value }))}
            />
            <input
              className="form-input form-input--sm"
              type="number"
              step="any"
              placeholder="Default dose"
              style={{ width: 100 }}
              value={newSupp.default_dose}
              onChange={(e) => setNewSupp((p) => ({ ...p, default_dose: e.target.value }))}
            />
            <select
              className="form-input form-input--sm"
              value={newSupp.dose_unit}
              onChange={(e) => setNewSupp((p) => ({ ...p, dose_unit: e.target.value }))}
              style={{ width: 110 }}
            >
              <option value="">unit…</option>
              {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <input
              className="form-input form-input--sm"
              placeholder="Notes (optional)"
              value={newSupp.notes}
              onChange={(e) => setNewSupp((p) => ({ ...p, notes: e.target.value }))}
            />
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn--sm btn--primary" onClick={saveCatalogItem} disabled={saving || !newSupp.name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {suppsLoading && <p className="tab-loading">Loading…</p>}

        <div className="catalog-list">
          {supplements.map((s) => (
            <div key={s.id} className={`catalog-item ${!s.is_active ? 'catalog-item--inactive' : ''}`}>
              {editingSupp?.id === s.id ? (
                <div className="catalog-item__edit">
                  <input
                    className="form-input form-input--sm"
                    value={editingSupp.name}
                    onChange={(e) => setEditingSupp({ ...editingSupp, name: e.target.value })}
                  />
                  <input
                    className="form-input form-input--sm"
                    type="number"
                    step="any"
                    style={{ width: 80 }}
                    value={editingSupp.default_dose ?? ''}
                    onChange={(e) => setEditingSupp({ ...editingSupp, default_dose: Number(e.target.value) || null })}
                  />
                  <select
                    className="form-input form-input--sm"
                    style={{ width: 110 }}
                    value={editingSupp.dose_unit ?? ''}
                    onChange={(e) => setEditingSupp({ ...editingSupp, dose_unit: e.target.value || null })}
                  >
                    <option value="">unit…</option>
                    {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button className="btn btn--sm btn--primary" onClick={updateCatalogItem} disabled={saving}>Save</button>
                  <button className="btn btn--sm" onClick={() => setEditingSupp(null)}>Cancel</button>
                </div>
              ) : (
                <div className="catalog-item__row">
                  <span className="catalog-item__name">{s.name}</span>
                  {s.default_dose != null && (
                    <span className="catalog-item__dose">{s.default_dose}{s.dose_unit ?? ''}</span>
                  )}
                  {!s.is_active && <span className="catalog-item__inactive-badge">inactive</span>}
                  <div className="catalog-item__actions">
                    <button className="btn btn--sm btn--ghost" onClick={() => setEditingSupp(s)}>Edit</button>
                    {s.is_active && (
                      <button className="btn btn--sm btn--ghost" onClick={() => deactivate(s.id)}>Deactivate</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {supplements.length === 0 && !suppsLoading && (
            <p className="tab-empty">No supplements in catalog yet. Add one above.</p>
          )}
        </div>
      </section>
    </div>
  );
}
