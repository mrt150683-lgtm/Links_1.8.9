# PotChat — Refactor Change Log

## Overview

The monolithic `src/App.tsx` (539 lines) was refactored into a reusable, integration-ready `<PotChat>` module with a clean adapter boundary, extracted sub-components, real settings toggles, bug fixes, and a lean dependency footprint.

---

## New File Structure

```
src/
├── App.tsx                          # Now a thin demo shell only (~20 lines)
├── types.ts                         # Unchanged — shared domain types
├── utils.ts                         # Unchanged — cn() helper
├── main.tsx                         # Unchanged
├── index.css                        # Unchanged
│
├── pot-chat/                        # NEW — the reusable module
│   ├── index.ts                     # Public export surface
│   ├── PotChat.tsx                  # Main component (no mock imports)
│   ├── adapter.ts                   # PotChatAdapter interface
│   ├── potChatTypes.ts              # PotChatSettings + type re-exports
│   ├── contextPayload.ts            # Pure helpers for context assembly
│   └── components/
│       ├── EntryIcon.tsx
│       ├── Header.tsx
│       ├── MessageBubble.tsx
│       ├── Timeline.tsx
│       ├── Composer.tsx
│       ├── ActiveContextPanel.tsx
│       ├── KnowledgeBrowser.tsx
│       ├── EntryViewerModal.tsx
│       ├── ImageLightboxModal.tsx   # Bug fixed
│       └── SettingsModal.tsx        # Real toggles
│
└── demo/                            # NEW — demo-only, not part of the module
    ├── mockData.ts                  # Moved from src/mockData.ts
    └── mockAdapter.ts               # Implements PotChatAdapter with mock data
```

---

## Key Changes

### 1. `PotChatAdapter` interface (`src/pot-chat/adapter.ts`)
All data access is now behind this interface — `PotChat.tsx` never imports mock data directly.

| Method | Description |
|---|---|
| `listEntries(potId)` | Load all pot entries |
| `listThreads(potId)` | Load all chat threads |
| `saveThreadAsEntry(potId, thread)` | Persist a chat as a new entry |
| `openEntry?(entryId)` | Optional: deep-link / open in host app |
| `loadEntryContent?(entryId)` | Optional: lazy-load full content |
| `estimateTokens?(text)` | Optional: override token heuristic |
| `nowIso?()` | Optional: override timestamp (for tests) |

### 2. `PotChat` component props (`src/pot-chat/PotChat.tsx`)

```tsx
<PotChat
  potId="p1"
  adapter={myAdapter}
  models={models}
  selectedModelId={selectedId}
  onSelectedModelIdChange={setSelectedId}
  initialSettings={{ compactMode: true }}   // optional overrides
  storageKey="my-app-pot-chat"              // optional, for localStorage
/>
```

No hardcoded pot IDs or model lists inside the component.

### 3. Settings — real toggles + localStorage persistence

Settings are stored in `localStorage[storageKey + ':settings']` and control live behavior:

| Setting | Effect |
|---|---|
| `metadataOnlyByDefault` | Updates the label in the Header bar |
| `autoSaveChatAsEntry` | Debounce-saves (1 s) the thread after each assistant reply |
| `showSourceSnippets` | Shows/hides the italic snippet text on citation chips |
| `compactMode` | Reduces padding in Timeline and Composer |

Previously these toggles were visual-only with no state.

### 4. Bug fix — Image Lightbox close button (`ImageLightboxModal.tsx`)
The original close button rendered an `X` icon but had no `onClick` handler, so clicking it did nothing. Fixed: `onClick={() => onClose()}` is now wired correctly on the button element.

### 5. Knowledge Browser search fix (`KnowledgeBrowser.tsx`)
Search previously only matched `title` and `tags` + `entities`. It now also matches:
- `artifacts.shortSummary`
- `artifacts.summaryBullets[]` (any bullet)

### 6. Demo harness

`src/App.tsx` is now a ~20-line shell:
```tsx
export default function App() {
  const [selectedModelId, setSelectedModelId] = useState(mockModels[0].id);
  return (
    <PotChat potId="p1" adapter={mockAdapter} models={mockModels}
             selectedModelId={selectedModelId}
             onSelectedModelIdChange={setSelectedModelId} />
  );
}
```

`src/demo/mockAdapter.ts` implements `PotChatAdapter` using in-memory arrays. Calling `saveThreadAsEntry` pushes to the array, so subsequent `listEntries` calls reflect saved chats.

### 7. Dependency cleanup (`package.json`)

Removed packages that were unused in the UI prototype:

| Package | Reason removed |
|---|---|
| `@google/genai` | No live LLM calls in this prototype |
| `express` | No server in this frontend-only app |
| `better-sqlite3` | No database in this frontend-only app |
| `dotenv` | No env vars needed client-side |
| `motion` | Unused animation library |
| `@types/express` | devDep for removed express |

### 8. Public module export surface (`src/pot-chat/index.ts`)

```ts
import { PotChat, PotChatAdapter, PotChatSettings, PotEntry, ChatThread, ... } from './pot-chat';
```

All public types and the main component are exported from a single index, ready for integration into a host application.

---

## What Was NOT Changed

- `src/types.ts` — domain types are stable, unchanged
- `src/utils.ts` — `cn()` helper unchanged
- `src/main.tsx` — unchanged
- `src/index.css` — unchanged
- `vite.config.ts` — unchanged
- No backend endpoints were added or modified
- The old `src/mockData.ts` path is superseded by `src/demo/mockData.ts` (same data, just relocated)
