# Chrome Extension Plan — Links Research Capture

## Overview

The **Links Chrome Extension** enables right-click capture of web content directly into research pots. It's a lightweight, minimalist companion to the Links backend, designed to work seamlessly with the application's Obsidian + Gold design system.

The extension integrates with Phase 11 (Chrome Extension Bridge) backend endpoints, providing:
- **Text selection capture** → store highlighted text with page context
- **Image capture** → right-click images and save as assets
- **Page capture** → save entire page URL/title for reference
- **YouTube capture** → extract page HTML for video transcription processing

---

## Design Philosophy

1. **Minimalist UI**: No bulky popups. Quick right-click menu → action → done.
2. **Obsidian + Gold theme**: Match `apps/web/src/styles/global.css` color scheme.
3. **Icon reuse**: Leverage existing icons from `apps/web/src/assets/icons/` where possible.
4. **Local-first**: All processing happens on the user's Links instance; no cloud relay.
5. **Token-based security**: Use the rotating extension token from Phase 11.

---

## Color Palette & Design System

The extension inherits the application's design tokens:

```css
/* Obsidian backgrounds */
--bg-0: #10141A;       /* Main background */
--bg-1: #131A21;       /* Alternate background */

/* Surfaces */
--surface-0: #171E26;  /* Card/panel surface */
--surface-1: #1B232C;  /* Elevated surface */

/* Text colors */
--text-0: #E8EEF6;     /* Primary text */
--text-1: #A9B4C0;     /* Secondary text */
--text-2: #7D8A98;     /* Tertiary text */

/* Gold accents */
--gold-0: #F0E1B0;     /* Bright gold (highlights) */
--gold-1: #D6BF74;     /* Primary gold (buttons) */
--gold-2: #A88340;     /* Muted gold (borders) */
--gold-3: #6B5328;     /* Dark gold (bg) */

/* States */
--success: #4FB06D;    /* Green (success) */
--warning: #D6BF74;    /* Yellow (warning) */
--danger: #D06A6A;     /* Red (error) */

/* Spacing (8pt grid) */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;

/* Radius */
--r-card: 16px;
--r-button: 10px;
```

---

## Architecture

### File Structure

```
apps/extension/
├── public/
│   └── manifest.json
├── src/
│   ├── background.ts          # Service worker
│   ├── content.ts             # Content script (runs on pages)
│   ├── popup.tsx              # Popup UI (options/settings)
│   ├── styles/
│   │   ├── popup.css
│   │   └── theme.css          # Design system tokens
│   ├── types/
│   │   └── index.ts           # TypeScript types
│   ├── utils/
│   │   ├── api.ts             # Backend API client
│   │   ├── auth.ts            # Token management
│   │   ├── storage.ts         # Chrome storage helpers
│   │   └── context.ts         # Capture context builders
│   └── icons/
│       └── (symlink or copies from apps/web/src/assets/icons)
├── package.json
├── tsconfig.json
└── vite.config.ts             # Build config for Vite
```

### Design Components

#### Right-Click Context Menu
Minimalist menu with:
- **Save selection** → captures highlighted text
- **Save image** → captures image as asset
- **Save page** → saves URL/title for reference
- **Save for transcription** → YouTube/video pages get HTML snapshot
- **Settings** → open extension options (pot selection, auto-save preferences)

#### Popup (Extension Icon Click)
Small modal showing:
- Currently selected pot (dropdown to switch)
- Last capture status (success/pending/error)
- Quick settings toggle (auto-save enabled/disabled)
- Link to full Links app

#### Options Page
Settings interface:
- Select default pot for captures
- Enable/disable auto-save mode
- Show/hide per-pot capture counts
- API endpoint configuration (default: http://localhost:3001)
- Token display (with "rotate" button to match backend rotation)

---

## Backend Integration (Phase 11)

### Authentication

Extension includes token in every request:

```bash
Authorization: Bearer <ext-token>
X-Request-ID: <unique-id>
```

Token stored in `chrome.storage.local` (encrypted by Chrome):
```json
{
  "ext_token": "...",
  "endpoint": "http://localhost:3001",
  "pot_id": "uuid"
}
```

Token rotation via `POST /ext/auth/rotate`:
- User clicks "Rotate Token" in options
- Extension calls endpoint with old token
- Backend returns new token once
- Extension stores new token

### Endpoints Used

#### 1. Text Selection Capture
```
POST /ext/capture/selection
Authorization: Bearer <token>
Content-Type: application/json

{
  "pot_id": "uuid",
  "text": "selected text...",
  "client_capture_id": "optional-dedupe-id",
  "captured_at": 1707123456789,
  "page": {
    "url": "https://example.com/article",
    "title": "Article Title"
  },
  "selection_context": {
    "anchor_text": "word before selection",
    "surrounding_text": "...context snippet...",
    "frame_url": "optional-if-cross-frame"
  }
}
```

#### 2. Image Capture
```
POST /ext/capture/image
Authorization: Bearer <token>
Content-Type: multipart/form-data

Form fields:
  - file: <binary image data>
  - pot_id: uuid
  - captured_at: timestamp
  - page_url: https://example.com
  - page_title: Page Title
  - client_capture_id: optional
```

#### 3. Page Capture (Link Entry)
```
POST /ext/capture/page
Authorization: Bearer <token>
Content-Type: application/json

{
  "pot_id": "uuid",
  "url": "https://example.com",
  "title": "Page Title",
  "excerpt": "optional excerpt",
  "client_capture_id": "optional-dedupe-id",
  "captured_at": 1707123456789
}
```

#### 4. YouTube/Video HTML Capture
```
POST /ext/capture/page  (same as page capture)

{
  "pot_id": "uuid",
  "url": "https://youtube.com/watch?v=...",
  "title": "Video Title",
  "excerpt": "Video description or transcript snippet",
  "html_snapshot": "optional full page HTML for processing",
  "metadata": {
    "video_duration": 3600,
    "video_id": "...",
    "type": "youtube"
  },
  "captured_at": timestamp,
  "client_capture_id": "optional"
}
```

---

## Feature Details

### 1. Text Selection Capture

**Trigger:** Right-click highlighted text → "Save selection"

**Flow:**
1. Content script detects selection
2. Builds context (surrounding text, page URL/title)
3. Shows temporary status popup
4. Sends to `/ext/capture/selection`
5. Displays success/error toast

**Features:**
- Deduplication via `client_capture_id` (hash of selection + page URL)
- Captures surrounding context for better connection finding
- Shows "Saving..." state with subtle animation
- Success notification: "✓ Saved to [Pot Name]"

**Edge cases:**
- Cross-frame selections: fallback to frame URL if available
- Very long selections (>200k chars): warn user, allow truncation
- No text selected: show helpful tooltip

### 2. Image Capture

**Trigger:** Right-click image → "Save image"

**Flow:**
1. Content script detects image element
2. Fetches image data (blob)
3. Shows upload progress (optional, for large images)
4. Sends multipart POST to `/ext/capture/image`
5. Success notification with image thumbnail

**Features:**
- Direct upload (no fetch-by-URL initially)
- Shows image preview in confirmation
- Deduplication via SHA256 (handled by backend)
- Supports: PNG, JPG, GIF, WebP, etc.
- Size limit: 25MB (enforced by backend)

**Edge cases:**
- Blocked images (CORS): show "Unable to access image" message
- Data URLs (base64): upload directly
- SVGs: handle gracefully

### 3. Page Capture (Link Entry)

**Trigger:** Right-click page → "Save page" (or auto-trigger on YouTube)

**Flow:**
1. Context menu click triggers
2. Extracts page URL, title, optional excerpt
3. Sends to `/ext/capture/page`
4. Shows brief confirmation

**Features:**
- Minimal payload (URL + title only)
- Optional excerpt (meta description, first paragraph)
- Perfect for bookmarking reference links
- Creates "link" entry type (Phase 11)

### 4. YouTube/Video HTML Capture

**Trigger:** Auto-detect YouTube URLs → right-click → "Save for transcription"

**Flow:**
1. Detect if page is YouTube/Vimeo/similar
2. Show specialized context menu item
3. Optionally fetch page HTML snapshot
4. Extract video metadata (duration, video ID, title)
5. Send to `/ext/capture/page` with metadata
6. Backend enqueues transcription job

**Features:**
- Auto-detect video platforms (YouTube, Vimeo, etc.)
- Extract video duration, ID, thumbnail
- Optional full HTML snapshot for content analysis
- Marked with metadata `type: "youtube"` for processing
- Backend can use snapshot for transcript extraction

**Metadata captured:**
```json
{
  "video_id": "...",
  "duration": 3600,
  "platform": "youtube",
  "channel": "Channel Name",
  "publish_date": "2024-01-15",
  "thumbnail_url": "https://..."
}
```

---

## UI/UX Details

### Icon Usage

Reuse from `apps/web/src/assets/icons/`:

| Feature | Icon | Color |
|---------|------|-------|
| Save selection | `text.png` | Gold |
| Save image | `image.png` | Gold |
| Save page | `doc.png` or link icon | Gold |
| Transcription | `video.png` | Gold |
| Settings | `settings.jpg` | Text-2 |
| Logo/badge | `logo_links.png` | Gold |

### Context Menu Labels

```
📌 Save selection to Links
🖼️ Save image to Links
🔗 Save page to Links
🎥 Save for transcription (YouTube pages only)
─────────────────────
⚙️ Links Settings
```

### Toast Notifications

- **Success**: "✓ Saved to [Pot Name]" (2s auto-dismiss, gold accent)
- **Error**: "✗ Failed: [Reason]" (persistent until dismissed, red accent)
- **Pending**: "⏳ Saving..." (spinner, no dismiss button)

### Popup UI (Icon Click)

```
┌─────────────────────────────────┐
│ 🔗 Links                    ⚙️ │
├─────────────────────────────────┤
│ Current Pot:                    │
│ [ Research Notes      ▼ ]       │
│                                 │
│ Last Action: ✓ Image saved      │
│ 5 mins ago                      │
│                                 │
│ ☐ Auto-save mode               │
│                                 │
│ [  Open Links App  ]            │
└─────────────────────────────────┘
```

### Settings Page

```
Links Extension Settings
═══════════════════════════════════

Default Research Pot
  [ Research Notes ▼ ]

Capture Preferences
  ☐ Auto-save text selections
  ☐ Auto-save images
  ☐ Auto-save page URLs

API Configuration
  Endpoint: http://localhost:3001
  [ Test Connection ]

Extension Token
  Token: ••••••••••••••••••
  [ Rotate Token ]

About
  Version: 1.0.0
  [ Visit Links App ]
```

---

## Implementation Phases

### Phase E1: Core Structure & Auth

**Deliverables:**
- Manifest.json (v3)
- Service worker scaffold
- Chrome storage integration
- Token management
- API client with auth headers

**Tests:**
- Token persists to `chrome.storage.local`
- API requests include Bearer token
- Errors handled gracefully

### Phase E2: Right-Click Context Menu

**Deliverables:**
- Context menu entries (selection, image, page, YouTube)
- Content script message passing
- Selection detection

**Tests:**
- Context menu appears on right-click
- Menu items visible only when relevant (image only on images, etc.)
- Message passing works end-to-end

### Phase E3: Text & Page Capture

**Deliverables:**
- `/ext/capture/selection` integration
- `/ext/capture/page` integration
- Client capture ID deduplication
- Toast notifications

**Tests:**
- Selection captured with context
- Page URL captured correctly
- Toast appears on success/error

### Phase E4: Image Capture

**Deliverables:**
- Image blob fetching
- Multipart upload to `/ext/capture/image`
- Progress indicator for large images
- Error handling (CORS, data URLs)

**Tests:**
- Various image formats upload
- CORS errors handled gracefully
- Blob conversion works

### Phase E5: Popup & Options UI

**Deliverables:**
- Popup.tsx (React or lightweight UI)
- Options page (settings, token rotation, pot selection)
- CSS with Obsidian + Gold theme
- Icons integrated

**Tests:**
- Pot list loads from API
- Token rotation works
- Settings persist to storage

### Phase E6: YouTube/Video Detection

**Deliverables:**
- YouTube URL detection
- Video metadata extraction
- Optional HTML snapshot fetching
- Metadata payload building

**Tests:**
- YouTube/Vimeo URLs detected
- Metadata extracted correctly
- HTML snapshot optional (doesn't block on failure)

### Phase E7: Polish & Release

**Deliverables:**
- Icon and branding assets
- Manifest refinements
- Error messages localized/professional
- Performance optimizations
- QA checklist

**Tests:**
- Extension loads without errors
- All features work on test pages
- Memory/CPU reasonable
- Works across multiple tabs

---

## Security Considerations (Phase 11 alignment)

### Authentication
- Token stored in `chrome.storage.local` (Chrome encrypts)
- No tokens in logs or error messages
- Rotation via backend endpoint only

### Network
- Requests to `http://localhost:3001` only (configurable)
- No cross-site requests
- Uses HTTPS if configured to remote endpoint

### Data Handling
- No caching of sensitive user data
- Clear captured items from memory after send
- No telemetry or analytics

### Content Script Isolation
- Content script runs in isolated world (Manifest v3)
- Cannot access page scripts
- Minimal DOM manipulation

---

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Backend unreachable | Show error toast, offer retry |
| Token expired | Prompt for token rotation in popup |
| Pot not found | Show error "Selected pot not found" |
| Selection too large | Warn and allow truncation |
| Image CORS blocked | Show "Unable to access image" |
| Network timeout | Retry 2x, then error |
| Invalid image format | Show "Unsupported image format" |
| YouTube HTML fetch fails | Ignore, proceed with metadata only |

---

## Testing Strategy

### Manual QA Checklist

- [ ] Text selection capture works on multiple domains
- [ ] Image capture works for PNG, JPG, GIF, WebP
- [ ] Page capture creates link entries
- [ ] YouTube detection shows specialized menu
- [ ] Settings popup displays and updates
- [ ] Token rotation works
- [ ] Pot switcher updates correctly
- [ ] Error messages are helpful
- [ ] Extension doesn't break page functionality
- [ ] Icons display correctly
- [ ] Colors match Obsidian + Gold theme
- [ ] Responsive on different screen sizes

### Automated Tests

- Token validation logic
- Message passing between content/background
- API payload validation
- Error handling scenarios
- Storage persistence

---

## Git Workflow

Commits follow Phase naming:

```
feat(ext): add manifest and service worker skeleton
feat(ext): add context menu and message passing
feat(ext): add text/page capture endpoints
feat(ext): add image upload integration
feat(ext): add popup ui and options page
feat(ext): add youtube detection and metadata extraction
feat(ext): add theming and polish
test(ext): add extension integration tests
docs: update extension plan and QA checklist
```

---

## Dependencies

### Runtime
- `chrome` API (built-in)
- Fetch API (modern Chrome versions)
- Optionally: React (for popup/options UI) or vanilla JS

### Development
- TypeScript
- Vite (for bundling)
- pnpm (matching monorepo)

### Build
- `vite.config.ts` with Chrome-specific output (service worker + content script separate)

---

## Deployment & Distribution

### Development
```bash
cd apps/extension
pnpm install
pnpm build
# Load unpacked from chrome://extensions/
```

### Testing
- Load unpacked extension in dev mode
- Run against local Links instance
- Manual QA per phase

### Release
- Create signed .crx file (or upload to Chrome Web Store later)
- Version in `manifest.json`
- Include release notes per phase

---

## Future Enhancements (Post-MVP)

1. **Batch captures**: Queue multiple selections while offline
2. **Sync indicator**: Show sync status in popup
3. **Capture history**: Quick access to recent captures
4. **Search from extension**: Quick search current pot
5. **Voice notes**: Optional voice-to-text capture
6. **Screenshot capture**: Full page or region screenshot
7. **PDF annotation**: Highlight and capture from PDFs
8. **E-reader integration**: Highlight from Kindle/Readwise
9. **Web clipper mode**: Full page save with formatting
10. **Multi-account support**: Switch between multiple Links instances

---

## Conclusion

The Links Extension is a lightweight, beautifully designed right-click companion that makes research capture frictionless. By leveraging the Phase 11 backend endpoints and matching the application's Obsidian + Gold design system, it provides seamless integration between the web and the Links research vault.

**Design principle:** Minimal UI, maximum utility. No noise, no bloat—just quick, reliable capture.
