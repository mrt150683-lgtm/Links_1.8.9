# UI_Plan.md — Links UI (Admin + Review + Settings)

This plan turns the existing UI style guide into a practical screen map + CRUD flows for **pots, entries, assets, jobs, AI artifacts, links, and settings**.

Design must follow the existing shell: **top bar + tabs row + content**, with a **landing grid** of dashboard tiles and consistent “glass card” panels.  

---

## 0) Design constraints (from UI.md)

- **App shell:** top bar + tab row + content.
- **Landing grid:** 3 columns desktop, 2 tablet, 1 mobile.
- **Content header:** search + filters + view toggles in one row where possible.
- **Primary building blocks:** dashboard tile cards + content cards.
- **Status pill:** bottom-right “System Operational” style.

(Implementation detail lives in `UI.md`; this plan focuses on screens and behavior.)

---

## 1) Navigation / Information Architecture

### 1.1 Tabs (primary navigation)
Tabs row (text buttons, gold active state) is the core “mode switch”. Recommended tabs:

1. **Dashboard**
2. **Pots**
3. **Inbox**
4. **Search**
5. **Graph**
6. **Jobs**
7. **Settings**
8. **Audit**

### 1.2 Routes (deep links)
- `/` Dashboard
- `/pots` Pots list
- `/pots/:potId` Pot detail
- `/pots/:potId/entries/:entryId` Entry detail
- `/assets` Global asset library (optional) + `/pots/:potId/assets`
- `/search` Search + advanced filters
- `/graph` Graph explorer (global) + `/graph/:potId`
- `/jobs` Job queue + worker status
- `/settings` Settings hub
- `/audit` Audit log
- `/import` Import wizard
- `/export/:potId` Export wizard

### 1.3 Global UI elements
- **Top bar**: app name, connection dot, 1–2 icon buttons (refresh models, open command palette).
- **Status pill** (bottom-right): system/worker/api status.
- **Toasts**: success/error notifications (never leak secrets).

---

## 2) Core entities & required CRUD surfaces

### 2.1 Pot
**CRUD needed**
- Create pot (name, description, optional retention policy)
- Read/list pots
- Update pot metadata + per-pot settings
- Delete pot (soft delete + “secure wipe” option if enabled)

**Extra actions**
- Export pot (private/public mode)
- Import pot (as new pot)
- Rotate pot key (future; settings stub)

### 2.2 Entry (text / link / image / doc / note)
**CRUD needed**
- List entries (global + per-pot)
- View entry detail (content + metadata + derived artifacts + links)
- Edit entry metadata (title, notes, tags; move to another pot)
- Delete entry (soft delete + “forget/secure wipe” option)

**Extra actions**
- Re-run pipeline jobs for an entry (tagging, summary, linking)
- Attach/detach asset references (image/doc)
- Approve/reject AI-derived artifacts (optional review mode)

### 2.3 Asset (encrypted blobs)
**CRUD needed**
- List assets (global + per-pot view)
- Upload asset (dedupe by sha256)
- View asset metadata + “referenced by” list
- Delete asset (only if unreferenced, or do a “force remove references” flow with warnings)

### 2.4 Derived artifacts (AI outputs)
These are *not* “truth”; they’re derived data with provenance.
- List artifacts for an entry (tags, summary, entities, extracted snippets)
- View artifact payload + model + prompt id/version + timestamp
- Promote artifact to “approved” (optional)
- Delete artifact (safe; regeneratable)

### 2.5 Links (relationships)
- List links per pot / per entry
- View link detail: src/dst, type, confidence, evidence excerpt
- Delete link (if wrong)
- “Recompute links” for pot/entry (job)

### 2.6 Jobs (processing)
- Queue list (queued/running/done/failed)
- Job detail: logs, timing, retries, model/prompt metadata
- Cancel / retry / requeue
- Worker status (idle mode settings)

### 2.7 Audit events
- Global searchable audit log
- Drill-down for a pot/entry/job
- Export audit slice (for debugging/share)

### 2.8 Settings (secrets + behavior)
- AI provider settings (OpenRouter key, model selection per task type, test call)
- Security settings (master key status, extension token, redaction controls)
- Data + retention settings (data directory, TTL policies, safe delete behavior)
- UI settings (theme variants, density)
- Logging settings (debug mode gating)

---

## 3) Page-by-page plan

### 3.1 Dashboard (Landing grid)
**Purpose:** “What’s going on?” in one glance, and fastest navigation.

**Layout**
- Landing grid of **dashboard tile cards**:
  - 🗂️ Pots (count)
  - 📥 Inbox (unreviewed/new captures count)
  - 🔍 Search
  - 🧩 Graph
  - ⚙️ Settings
  - 🧪 Jobs (queue + worker state)
  - 🧾 Audit

**Status strip**
- Worker: Idle / Running / Paused
- API: Connected / Disconnected
- Models: Cached age (e.g., “Models: refreshed 2h ago”)

**Primary actions**
- “Create pot”
- “Import pot”
- “Refresh models”
- “Run idle processing now” (manual kick)

---

### 3.2 Pots — list
**Content header**
- Search (by name/description)
- Filter chips: All / Recent / With failures / Has exports
- View toggle: Grid / List

**Pot cards**
- Title + short description
- Badges: LOCKED / TTL / EXPORTABLE
- Meta: entries count, assets count, last activity

**Row actions**
- Open
- Export
- Delete (always confirm)

---

### 3.3 Pot detail — overview
**Sub-tabs inside pot (secondary tabs inside content)**
- Overview
- Entries
- Assets
- Links
- Jobs
- Settings

#### 3.3.1 Overview
- Stats cards: entries, assets, artifacts, links
- Recent activity feed (audit slice)
- “Quick add”: create note entry, paste text, add link, upload file
- “Health”: last job failures, last successful pipeline run

#### 3.3.2 Pot settings (inside pot)
- Retention TTL (optional)
- Default processing behavior (auto-enqueue on capture)
- Export defaults (public/private; redaction toggles)
- Danger zone: delete pot / secure wipe

---

### 3.4 Entries — global Inbox
**Purpose:** fast triage of captured items, and a clear “review” surface.

**Content header**
- Search (full text where available; fallback to title/notes)
- Filter chips:
  - All / New / Needs review / Failed processing / With links / With assets
- Dropdowns:
  - Pot (All pots, or specific)
  - Type (text/link/image/doc/note)
  - Sort (Newest / Oldest / Most linked / Most tags)

**Content cards**
- Gold-highlight title + badge (TEXT / LINK / IMAGE / DOC / NOTE)
- Preview snippet
- Footer: tag pills + tiny buttons:
  - Open
  - Delete
  - Re-run jobs
  - Approve/Reject (only if review mode enabled)

---

### 3.5 Entry detail
**Left: main content panel**
- Render by type:
  - Text/note: formatted text + raw view toggle
  - Link: url + snapshot metadata
  - Image/doc: preview + download/open + sha256 + mime + size

**Right: “metadata stack” (cards)**
1. **Source**
   - capture method, url/title, created_at
2. **User edits**
   - title override, notes, manual tags
3. **AI artifacts**
   - summary, tags, entities (each with provenance)
   - per-artifact view + delete + regenerate
4. **Links**
   - related entries list (type + confidence)
5. **History**
   - audit events for this entry (collapsed)

**Actions (top-right)**
- Edit metadata
- Move to pot
- Delete (soft) / Forget (hard) — if enabled
- Re-run pipeline for this entry

**Editing rules**
- Editing content itself:
  - Allowed for notes/text entries (keeps original in history if you want provenance)
  - For link/image/doc, treat content as immutable; only metadata editable

---

### 3.6 Assets
Two views: **Global assets** (optional) and **Per-pot assets**.

**Content header**
- Search (filename, sha256 prefix, mime)
- Filter: All / Unreferenced / Images / Documents
- Upload button

**Asset card / row**
- Thumb (image) or doc icon
- sha256 (short), size, mime, created_at
- “Referenced by: N entries” (clickable)

**Delete behavior**
- If referenced: block delete and offer:
  - “Show references”
  - “Remove references then delete” (dangerous, requires multi-step confirm)
- If unreferenced: allow delete (still confirm)

---

### 3.7 Search
Assume two modes: “simple” now, “advanced” as backend search matures.

**Simple search**
- Query string, scoped by:
  - pot
  - type
  - date range
  - has tags / has links / has assets
- Results: content cards

**Advanced search (future-ready UI)**
- Query builder chips (AND/OR)
- “Fields”: title, notes, url, tags, entities
- Saved searches (settings later)

---

### 3.8 Graph
**Purpose:** explore relationships; sanity-check AI linking.

**Controls**
- Scope: global vs pot
- Filters:
  - link type
  - min confidence slider
  - show only entries with tags/entities
- Layout toggle: force-directed / timeline-ish (later)

**Node click**
- Opens entry preview drawer
- Shows “why linked” evidence excerpt
- Actions: open entry, delete link, recompute links

---

### 3.9 Jobs
**Top section: worker status**
- Idle mode: enabled/disabled
- Next allowed run window
- Concurrency / throttles (read from settings)
- “Run now” (manual kick)

**Queue list**
- Filters: queued / running / failed / done
- Columns: job type, pot, entry, status, retries, created_at, updated_at

**Job detail**
- Timeline of status transitions
- Sanitized logs
- Model + prompt id/version metadata
- Retry + cancel controls

---

### 3.10 Audit
**Content header**
- Search (text)
- Filters:
  - entity type (pot/entry/job/export/import)
  - action type
  - date range
  - severity

**Rows**
- timestamp
- action
- target (clickable)
- request_id (copy)
- metadata (collapsed JSON)

---

### 3.11 Settings (Hub + sections)
Settings should be a hub page with left-side section list (or internal tabs) to avoid “scroll of doom”.

#### 3.11.1 AI Provider (OpenRouter)
- API key (masked input)
- “Store in OS keychain” status (if available)
- Test call button (shows: success/fail + latency; no raw responses stored unless debug enabled)
- Model list:
  - “Refresh models” button
  - Cached models table
- Default model per task type:
  - tagging model
  - summarization model
  - linking model
- Generation controls:
  - temperature default (low)
  - max tokens cap
  - retries/backoff
  - timeout

#### 3.11.2 Security
- Master key status (set / locked / unlocked)
- Export/import passphrase hint behavior
- Extension token (rotate)
- Local bind + allowed origins (read-only display + advanced override)
- Debug logging toggle (must show “may include more content” warning)

#### 3.11.3 Data & Storage
- Data directory (read-only unless app supports moving)
- DB maintenance:
  - “Vacuum/compact”
  - “Integrity check”
- Backups:
  - export directory
  - auto-backup toggle (later)

#### 3.11.4 Retention & Redaction
- Defaults for new pots:
  - TTL off/on + duration
  - safe delete vs hard delete
- “Forget entry” behavior:
  - secure wipe files + DB row (if supported)
- Export mode defaults:
  - private vs public transform
  - which fields stripped in public mode

#### 3.11.5 UI
- Density: Compact / Cozy
- Motion: full / reduced
- Theme: obsidian-gold only (for now), with future hooks

---

## 4) Critical UX edge-cases (don’t skip these)

1. **Deletion needs consequences preview**
   - “Deleting this pot removes: X entries, Y assets (Z shared), N links, M artifacts.”
2. **Assets are shared via dedupe**
   - Deleting an asset must account for other pots referencing the same sha256.
3. **Secrets must never leak**
   - API keys masked; logs sanitized; copy buttons only where safe.
4. **Derived artifacts are not truth**
   - Always label AI outputs and show provenance (model + prompt version).
5. **Prompt injection hardening**
   - Any UI that shows “AI suggested actions” must be reviewable and reversible.
6. **Offline / disconnected mode**
   - App usable for capture + browsing without OpenRouter; show degraded state clearly.
7. **Import failure must be atomic**
   - UI should promise “all-or-nothing”; show clear error reason and recovery tip.

---

## 5) Minimal API surface the UI expects (mapping)

This isn’t full backend spec — it’s the *minimum* calls the UI must make.

### 5.1 Pots
- `GET /pots`
- `POST /pots`
- `GET /pots/:potId`
- `PATCH /pots/:potId`
- `DELETE /pots/:potId`

### 5.2 Entries
- `GET /pots/:potId/entries`
- `POST /pots/:potId/entries` (text/note/link)
- `GET /pots/:potId/entries/:entryId`
- `PATCH /pots/:potId/entries/:entryId`
- `DELETE /pots/:potId/entries/:entryId`

### 5.3 Assets
- `POST /pots/:potId/assets` (upload)
- `GET /pots/:potId/assets`
- `GET /assets/:sha256` (download/open; optional)
- `DELETE /assets/:sha256` (guarded; optional)

### 5.4 Processing / Jobs
- `GET /jobs`
- `GET /jobs/:jobId`
- `POST /jobs/:jobId/retry`
- `POST /jobs/:jobId/cancel`
- `POST /entries/:entryId/reprocess` (convenience)

### 5.5 Models / AI
- `GET /models`
- `POST /models/refresh`
- `POST /ai/test`

### 5.6 Export / Import
- `POST /pots/:potId/export`
- `POST /pots/import`

### 5.7 Audit
- `GET /audit`
- `GET /pots/:potId/audit`
- `GET /entries/:entryId/audit`

---

## 6) MVP sequencing (so you don’t build a cathedral first)

**MVP-1 (usable admin UI)**
- Dashboard
- Pots list + create
- Pot detail (Entries tab only)
- Entry detail
- Settings: OpenRouter key + model selection + test call
- Jobs list (read-only)
- Status pill + connection indicator

**MVP-2 (review + hygiene)**
- Asset management
- Delete flows with consequences preview + safe guards
- Audit log
- Basic graph view (even if simple list-first)

**MVP-3 (share & scale)**
- Export/import wizard
- Redaction controls + retention controls
- Advanced search UI hooks

---

## 7) “You’ll thank yourself later” instrumentation
- Every destructive action writes an audit event.
- Every AI artifact stores provenance and links back to job id.
- UI has a “Copy debug bundle” (logs + config sans secrets) for support.

