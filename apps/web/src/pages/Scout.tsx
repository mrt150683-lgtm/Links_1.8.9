import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ScoutPreferences } from '@/lib/types';
import { ScoutSettings } from '@/components/scout/ScoutSettings';
import { ScoutDiscovery } from '@/components/scout/ScoutDiscovery';
import { ScoutRuns } from '@/components/scout/ScoutRuns';
import { ScoutForge } from '@/components/scout/ScoutForge';
import './Scout.css';

type ScoutTab = 'discovery' | 'runs' | 'forge' | 'settings';

export function ScoutPage() {
  const [activeTab, setActiveTab] = useState<ScoutTab>('discovery');

  const { data: prefs } = useQuery({
    queryKey: ['scout-prefs'],
    queryFn: () =>
      api.get<ScoutPreferences>('/prefs/scout').catch(
        (): ScoutPreferences => ({
          github_token_set: false,
          github_token_hint: null,
          default_model: null,
          default_days: null,
          default_stars: null,
          default_max_stars: null,
          default_top_n: null,
          default_language: null,
          default_include_forks: null,
        }),
      ),
  });

  const tokenConfigured = prefs?.github_token_set ?? false;

  return (
    <div className="scout-page">
      <div className="scout-page__header">
        <h1>Scout</h1>
      </div>

      <div className="scout-page__tabs">
        {(['discovery', 'runs', 'forge', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            className={`scout-tab ${activeTab === tab ? 'scout-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'settings' && !tokenConfigured && (
              <span className="scout-tab__dot" title="GitHub token not configured" />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'discovery' && (
        <ScoutDiscovery tokenConfigured={tokenConfigured} prefs={prefs ?? null} />
      )}
      {activeTab === 'runs' && (
        <ScoutRuns tokenConfigured={tokenConfigured} />
      )}
      {activeTab === 'forge' && (
        <ScoutForge tokenConfigured={tokenConfigured} prefs={prefs ?? null} />
      )}
      {activeTab === 'settings' && <ScoutSettings />}
    </div>
  );
}
