import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DailyReview {
  id: string;
  review_date: string;
  model_id: string;
  payload: {
    totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    nutritional_gaps: string[];
    highlights: string[];
    adherence_note: string;
    confidence_note: string;
    low_confidence_meals_count: number;
    disclaimer: string;
  };
  meal_ids: string[];
  created_at: number;
}

export function DailyReviewsTab() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['nutrition', 'reviews', 'daily'],
    queryFn: () => api.get<{ reviews: DailyReview[] }>('/nutrition/reviews/daily?limit=30'),
  });

  const reviews = data?.reviews ?? [];

  if (isLoading) return <p className="tab-loading">Loading daily reviews…</p>;
  if (reviews.length === 0) return <p className="tab-empty">No daily reviews yet. Reviews are generated automatically at 23:50 each day.</p>;

  return (
    <div className="reviews-tab">
      <h2>Daily Nutrition Reviews</h2>
      <div className="review-list">
        {reviews.map((review) => {
          const isOpen = expanded === review.id;
          const p = review.payload;
          return (
            <div key={review.id} className="review-card">
              <button
                className="review-card__toggle"
                onClick={() => setExpanded(isOpen ? null : review.id)}
              >
                <span className="review-card__date">{review.review_date}</span>
                <span className="review-card__calories">
                  ~{Math.round(p.totals?.calories ?? 0)} kcal
                </span>
                <span className="review-card__chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="review-card__body">
                  <div className="review-card__macros">
                    <span>Protein: {p.totals?.protein_g?.toFixed(0) ?? '?'}g</span>
                    <span>Carbs: {p.totals?.carbs_g?.toFixed(0) ?? '?'}g</span>
                    <span>Fat: {p.totals?.fat_g?.toFixed(0) ?? '?'}g</span>
                  </div>

                  {p.highlights?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Highlights</h4>
                      <ul>{p.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                    </div>
                  )}

                  {p.nutritional_gaps?.length > 0 && (
                    <div className="review-card__section">
                      <h4>Nutritional Gaps</h4>
                      <ul>{p.nutritional_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    </div>
                  )}

                  {p.adherence_note && (
                    <div className="review-card__section">
                      <h4>Goal Adherence</h4>
                      <p>{p.adherence_note}</p>
                    </div>
                  )}

                  {p.confidence_note && (
                    <div className="review-card__section">
                      <h4>Data Confidence</h4>
                      <p>{p.confidence_note}</p>
                    </div>
                  )}

                  <p className="review-card__disclaimer">{p.disclaimer}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
