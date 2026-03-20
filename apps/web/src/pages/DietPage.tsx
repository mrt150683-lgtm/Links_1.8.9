import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TodayTab } from './diet/TodayTab';
import { LogTab } from './diet/LogTab';
import { DailyReviewsTab } from './diet/DailyReviewsTab';
import { WeeklyReviewsTab } from './diet/WeeklyReviewsTab';
import { RecipesTab } from './diet/RecipesTab';
import { CravingsTab } from './diet/CravingsTab';
import { RecipeBookTab } from './diet/RecipeBookTab';
import { ProfileTab } from './diet/ProfileTab';
import { ProgressTab } from './diet/ProgressTab';
import { WellbeingTab } from './diet/WellbeingTab';
import { SupplementsTab } from './diet/SupplementsTab';
import { PatternsTab } from './diet/PatternsTab';
import './DietPage.css';

type DietTab =
  | 'today'
  | 'log'
  | 'daily-reviews'
  | 'weekly-reviews'
  | 'progress'
  | 'recipes'
  | 'cravings'
  | 'recipe-book'
  | 'profile'
  | 'wellbeing'
  | 'supplements'
  | 'patterns';

const TABS: { id: DietTab; label: string }[] = [
  { id: 'today', label: "Today's Meals" },
  { id: 'log', label: 'Meal Log' },
  { id: 'daily-reviews', label: 'Daily Reviews' },
  { id: 'weekly-reviews', label: 'Weekly Reviews' },
  { id: 'progress', label: 'Progress' },
  { id: 'recipes', label: 'Generate Recipes' },
  { id: 'cravings', label: 'Cravings' },
  { id: 'recipe-book', label: 'Recipe Book' },
  { id: 'wellbeing', label: 'Wellbeing' },
  { id: 'supplements', label: 'Supplements' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'profile', label: 'Profile' },
];

export function DietPage() {
  const [activeTab, setActiveTab] = useState<DietTab>('today');

  // Provision diet pot on mount
  const { data: provision, error: provisionError } = useQuery({
    queryKey: ['nutrition', 'provision'],
    queryFn: () => api.get<{ pot_id: string }>('/nutrition/provision'),
    staleTime: Infinity,
  });

  if (provisionError) {
    return (
      <div className="diet-page">
        <div className="diet-page__error">
          Failed to provision diet workspace. Please check that the API is running.
        </div>
      </div>
    );
  }

  if (!provision) {
    return (
      <div className="diet-page">
        <div className="diet-page__loading">Setting up Diet workspace…</div>
      </div>
    );
  }

  return (
    <div className="diet-page">
      <div className="diet-page__header">
        <h1>Diet &amp; Nutrition</h1>
      </div>

      <nav className="diet-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`diet-tab ${activeTab === tab.id ? 'diet-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="diet-page__content">
        {activeTab === 'today' && <TodayTab potId={provision.pot_id} />}
        {activeTab === 'log' && <LogTab potId={provision.pot_id} />}
        {activeTab === 'daily-reviews' && <DailyReviewsTab />}
        {activeTab === 'weekly-reviews' && <WeeklyReviewsTab />}
        {activeTab === 'recipes' && <RecipesTab />}
        {activeTab === 'cravings' && <CravingsTab />}
        {activeTab === 'progress' && <ProgressTab />}
        {activeTab === 'recipe-book' && <RecipeBookTab />}
        {activeTab === 'wellbeing' && <WellbeingTab potId={provision.pot_id} />}
        {activeTab === 'supplements' && <SupplementsTab potId={provision.pot_id} />}
        {activeTab === 'patterns' && <PatternsTab potId={provision.pot_id} />}
        {activeTab === 'profile' && <ProfileTab />}
      </div>
    </div>
  );
}
