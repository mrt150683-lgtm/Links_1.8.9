import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface PatternFinding {
  pattern: string;
  ingredient_or_food?: string;
  related_symptoms: string[];
  frequency: string;
  confidence: 'possible' | 'likely' | 'consistent';
  note: string;
}

interface StackFinding {
  name: string;
  dose_logged?: string;
  observation: string;
  flag_type: 'possible_overlap' | 'possible_gap' | 'worth_reviewing' | 'ok';
  note: string;
}

interface PatternAnalysis {
  id: string;
  analysis_type: 'food_symptom' | 'ingredient_sensitivity' | 'stack_review';
  date_range_from: string;
  date_range_to: string;
  payload: {
    analysis_type?: string;
    date_range?: string;
    findings?: PatternFinding[];
    supplements_reviewed?: string[];
    overall_note?: string;
    disclaimer: string;
  };
  created_at: number;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  possible: '#888',
  likely: '#e8a020',
  consistent: '#2a8c2a',
};

const FLAG_COLORS: Record<string, string> = {
  possible_overlap: '#e8a020',
  possible_gap: '#4a90d9',
  worth_reviewing: '#9b59b6',
  ok: '#2a8c2a',
};

type AnalysisType = 'food_symptom' | 'ingredient_sensitivity' | 'stack_review';

const ANALYSIS_CARDS: { type: AnalysisType; title: string; desc: string }[] = [
  {
    type: 'food_symptom',
    title: 'Food & Symptoms',
    desc: 'Looks for correlations between what you ate and how you felt. Identifies possible food-symptom patterns based on your logs.',
  },
  {
    type: 'ingredient_sensitivity',
    title: 'Ingredient Sensitivity',
    desc: 'Focuses on specific ingredients that may be associated with recurring symptoms across multiple days.',
  },
  {
    type: 'stack_review',
    title: 'My Supplement Stack',
    desc: 'Reviews your supplement log alongside your diet to identify potential overlaps, gaps, or items worth discussing with a provider.',
  },
];

export function PatternsTab({ potId: _potId }: { potId: string }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<Record<AnalysisType, number>>({
    food_symptom: 14,
    ingredient_sensitivity: 14,
    stack_review: 14,
  });
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: analysesData } = useQuery({
    queryKey: ['nutrition', 'patterns'],
    queryFn: () => api.get<{ analyses: PatternAnalysis[] }>('/nutrition/patterns?limit=30'),
    staleTime: 30_000,
  });

  const analyses = analysesData?.analyses ?? [];

  async function runAnalysis(type: AnalysisType) {
    setRunning((r) => ({ ...r, [type]: true }));
    setErrors((e) => ({ ...e, [type]: '' }));
    try {
      await api.post('/nutrition/patterns/analyze', { type, days: days[type] });
      // Poll for results
      const pollUntilDone = () => {
        setTimeout(async () => {
          await qc.invalidateQueries({ queryKey: ['nutrition', 'patterns'] });
          setRunning((r) => ({ ...r, [type]: false }));
        }, 4000);
      };
      pollUntilDone();
    } catch (err) {
      setErrors((e) => ({ ...e, [type]: err instanceof Error ? err.message : 'Analysis failed' }));
      setRunning((r) => ({ ...r, [type]: false }));
    }
  }

  return (
    <div className="patterns-tab">
      <h2>Pattern Analysis</h2>
      <p className="tab-desc">
        On-demand analysis of your food logs, wellbeing data, and supplement history.
        Patterns are observational only — not diagnostic.
      </p>

      {ANALYSIS_CARDS.map((card) => {
        const cardAnalyses = analyses.filter((a) => a.analysis_type === card.type);
        const latest = cardAnalyses[0];
        const isRunning = running[card.type];

        return (
          <section key={card.type} className="pattern-card">
            <h3 className="pattern-card__title">{card.title}</h3>
            <p className="pattern-card__desc">{card.desc}</p>

            <div className="pattern-card__controls">
              <label className="form-label">Analyze last</label>
              <select
                className="form-input form-input--sm"
                value={days[card.type]}
                onChange={(e) => setDays((d) => ({ ...d, [card.type]: Number(e.target.value) }))}
                disabled={isRunning}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
              <button
                className="btn btn--primary"
                onClick={() => runAnalysis(card.type)}
                disabled={isRunning}
              >
                {isRunning ? 'Analyzing…' : 'Run Analysis'}
              </button>
            </div>

            {errors[card.type] && <div className="form-error">{errors[card.type]}</div>}

            {latest && (
              <div className="pattern-results">
                <div className="pattern-results__meta">
                  <span className="pattern-results__range">
                    {latest.date_range_from} → {latest.date_range_to}
                  </span>
                  <span className="pattern-results__when">
                    {new Date(latest.created_at).toLocaleString()}
                  </span>
                </div>

                {/* Food/ingredient findings */}
                {(card.type === 'food_symptom' || card.type === 'ingredient_sensitivity') &&
                  latest.payload.findings && (
                    <div className="findings-list">
                      {latest.payload.findings.length === 0 && (
                        <p className="tab-empty">No notable patterns found in this period.</p>
                      )}
                      {latest.payload.findings.map((f, i) => (
                        <div key={i} className="finding-item">
                          <div className="finding-item__header">
                            <span className="finding-item__pattern">{f.pattern}</span>
                            <span
                              className="finding-item__confidence"
                              style={{ color: CONFIDENCE_COLORS[f.confidence] }}
                            >
                              {f.confidence}
                            </span>
                          </div>
                          {f.ingredient_or_food && (
                            <div className="finding-item__food">Food: {f.ingredient_or_food}</div>
                          )}
                          {f.related_symptoms?.length > 0 && (
                            <div className="finding-item__symptoms">
                              Symptoms: {f.related_symptoms.join(', ')}
                            </div>
                          )}
                          <div className="finding-item__freq">Frequency: {f.frequency}</div>
                          <div className="finding-item__note">{f.note}</div>
                        </div>
                      ))}
                    </div>
                  )}

                {/* Stack findings */}
                {card.type === 'stack_review' && (
                  <div className="findings-list">
                    {latest.payload.supplements_reviewed && latest.payload.supplements_reviewed.length > 0 && (
                      <div className="findings-list__reviewed">
                        Reviewed: {latest.payload.supplements_reviewed.join(', ')}
                      </div>
                    )}
                    {(latest.payload as any).findings?.map((f: StackFinding, i: number) => (
                      <div key={i} className="finding-item">
                        <div className="finding-item__header">
                          <span className="finding-item__pattern">{f.name}</span>
                          {f.dose_logged && <span className="finding-item__dose">{f.dose_logged}</span>}
                          <span
                            className="finding-item__flag"
                            style={{ color: FLAG_COLORS[f.flag_type] }}
                          >
                            {f.flag_type.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="finding-item__note">{f.observation}</div>
                        <div className="finding-item__note finding-item__note--secondary">{f.note}</div>
                      </div>
                    ))}
                    {latest.payload.overall_note && (
                      <div className="findings-list__overall">{latest.payload.overall_note}</div>
                    )}
                  </div>
                )}

                <p className="pattern-disclaimer">{latest.payload.disclaimer}</p>

                {cardAnalyses.length > 1 && (
                  <details className="pattern-history">
                    <summary>Previous analyses ({cardAnalyses.length - 1})</summary>
                    {cardAnalyses.slice(1).map((a) => (
                      <div key={a.id} className="pattern-history__item">
                        <span>{a.date_range_from} → {a.date_range_to}</span>
                        <span className="pattern-history__when">{new Date(a.created_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}

            {!latest && !isRunning && (
              <p className="tab-empty">No analysis run yet. Click "Run Analysis" to start.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
