import { useState } from 'react';
import { RssViewerTab } from './rss/RssViewerTab';
import { MyFeedsTab } from './rss/MyFeedsTab';
import { DiscoverTab } from './rss/DiscoverTab';
import { SuggestionsTab } from './rss/SuggestionsTab';
import { RssSettingsTab } from './rss/RssSettingsTab';
import './RssPage.css';

type RssTab = 'viewer' | 'my-feeds' | 'discover' | 'suggestions' | 'settings';

const TABS: { id: RssTab; label: string }[] = [
  { id: 'viewer', label: 'RSS Viewer' },
  { id: 'my-feeds', label: 'My Feeds' },
  { id: 'discover', label: 'Discover' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'settings', label: 'Settings' },
];

export function RssPage() {
  const [activeTab, setActiveTab] = useState<RssTab>('viewer');

  return (
    <div className="rss-page">
      <div className="rss-page__header">
        <h1>RSS Feeds</h1>
      </div>

      <nav className="rss-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`rss-tab ${activeTab === tab.id ? 'rss-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="rss-page__content">
        {activeTab === 'viewer' && <RssViewerTab />}
        {activeTab === 'my-feeds' && <MyFeedsTab />}
        {activeTab === 'discover' && <DiscoverTab />}
        {activeTab === 'suggestions' && <SuggestionsTab />}
        {activeTab === 'settings' && <RssSettingsTab />}
      </div>
    </div>
  );
}
