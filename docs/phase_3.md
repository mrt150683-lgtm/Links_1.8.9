````md

\# Phase\_3.md — Ingestion API (Clipboard Capture + Popup Workflow Contract)



\## Purpose

Phase 3 turns the Phase 2 “store text entry” endpoints into a \*\*real ingestion layer\*\* that your Ctrl+C popup (and later UI) can rely on without you having to babysit it.



This phase focuses on:

\- \*\*fast pot selection\*\* for the popup

\- \*\*capture requests\*\* with strong metadata

\- \*\*auto-save mode\*\* (stop pressing save 400 times)

\- \*\*dedupe + idempotency\*\* so repeated sends don’t spam the DB

\- \*\*preferences\*\* (last used pot, default pot, autosave per pot)

\- \*\*QA-first\*\*: everything testable with curl + smoke script + integration tests



No browser extension yet. No assets yet. No AI yet.



---



\## Definition of Done

Phase 3 is complete only when:



\### ✅ Popup workflow support

\- API can return “pot picker” list quickly and sorted by most relevant usage.

\- Client can set and read:

&nbsp; - last used pot

&nbsp; - default pot

&nbsp; - autosave mode per pot (or global + overrides)



\### ✅ Idempotent capture

\- Client can safely retry capture calls without creating duplicates.

\- Dedupe works via `client\_capture\_id` (preferred) and/or content hash heuristics.



\### ✅ Metadata is strong

\- Capture endpoints accept rich metadata (source url/title, app context, selection context).

\- Metadata is stored and queryable.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - prefs read/write

&nbsp; - idempotent capture

&nbsp; - pot list ordering

&nbsp; - entry creation with metadata

\- Smoke script exists for the full popup flow.



\### ✅ Documentation

\- `docs/api.md` (or equivalent) updated with Phase 3 routes.

\- `docs/qa.md` updated with Phase 3 QA steps.

\- `CHANGELOG.md` updated.



---



\## What changes from Phase 2

Phase 2: “you can store pots and text entries.”



Phase 3: “you can reliably ingest from a popup and not create duplicates, while persisting capture settings.”



---



\## Data Model Additions (Phase 3)

\### 1) Pot usage tracking

Add fields to `pots` OR add a new table. Recommended: keep it simple and add fields.



\*\*Option A (simple): add to `pots`\*\*

\- `last\_used\_at` (INTEGER epoch ms, nullable)

\- `entry\_count` (INTEGER, optional derived cache; can be maintained later)



Index:

\- `idx\_pots\_last\_used\_at`



\*\*Option B (more correct): `pot\_usage` table\*\*

\- `pot\_id` (FK)

\- `last\_used\_at`

\- `last\_capture\_method`

\- `capture\_count`

Index:

\- `idx\_pot\_usage\_last\_used\_at`



Phase 3 recommendation: \*\*Option A\*\* (fewer moving parts).



\### 2) User preferences (local-only)

Table: `user\_prefs` (single-row key/value store)

\- `key` (TEXT, primary key)

\- `value\_json` (TEXT)



Keys used in Phase 3:

\- `capture.default\_pot\_id`

\- `capture.last\_pot\_id`

\- `capture.autosave.enabled` (global bool)

\- `capture.autosave.pot\_overrides` (map pot\_id -> bool)

\- `capture.popup.pot\_list\_limit` (number)

\- `capture.popup.sort\_mode` (`recent` default)



\### 3) Entry idempotency

Add to `entries`:

\- `client\_capture\_id` (TEXT, nullable) — unique per pot if provided

\- `source\_app` (TEXT, nullable) — e.g. `desktop`, `chrome`, `terminal`

\- `source\_context\_json` (TEXT, nullable) — window title, selection offsets, etc.



Constraint (recommended):

\- `UNIQUE(pot\_id, client\_capture\_id)` where `client\_capture\_id` is not null



Indexes:

\- `idx\_entries\_pot\_id\_client\_capture\_id`



---



\## API (Phase 3)



\### A) Popup pot picker

\#### `GET /capture/pots`

Returns a \*\*thin\*\* list optimised for popups:

\- sorted by last\_used\_at desc (fallback created\_at)

\- limit default 20 (configurable via prefs)



Response example:

```json

{

&nbsp; "pots": \[

&nbsp;   { "id": "uuid", "name": "Case A", "last\_used\_at": 123, "created\_at": 100 }

&nbsp; ]

}

````



Acceptance:



\* query time stays low even with many pots (indexes correct)



---



\### B) Preferences (popup state + autosave)



\#### `GET /prefs/capture`



Returns capture-related preferences.



\#### `PUT /prefs/capture`



Sets capture preferences. Body example:



```json

{

&nbsp; "default\_pot\_id": "uuid",

&nbsp; "last\_pot\_id": "uuid",

&nbsp; "autosave": {

&nbsp;   "enabled": true,

&nbsp;   "pot\_overrides": {

&nbsp;     "pot\_uuid\_1": true,

&nbsp;     "pot\_uuid\_2": false

&nbsp;   }

&nbsp; },

&nbsp; "popup": {

&nbsp;   "pot\_list\_limit": 25,

&nbsp;   "sort\_mode": "recent"

&nbsp; }

}

```



Rules:



\* Validate pot IDs exist (if supplied).

\* Missing fields = leave unchanged (PATCH-like) OR require full object (choose one and document it).

&nbsp; Recommended: PATCH-like to avoid UI sending full state constantly.



---



\### C) Capture endpoint (idempotent)



This is the main “Ctrl+C popup hits Save” route.



\#### `POST /capture/text`



Body:



```json

{

&nbsp; "pot\_id": "uuid",

&nbsp; "text": "captured text",

&nbsp; "client\_capture\_id": "uuid-or-random-string",

&nbsp; "capture\_method": "clipboard",

&nbsp; "captured\_at": 1234567890,



&nbsp; "source\_url": "https://example.com",

&nbsp; "source\_title": "Page Title",

&nbsp; "notes": "optional",



&nbsp; "source\_app": "desktop",

&nbsp; "source\_context": {

&nbsp;   "window\_title": "Some App",

&nbsp;   "selection\_hint": "optional",

&nbsp;   "extra": "anything you want"

&nbsp; }

}

```



Behavior:



\* Compute canonical hash (Phase 2 rules).

\* If `client\_capture\_id` exists:



&nbsp; \* \*\*idempotent insert\*\*: if already exists (same pot), return existing entry.

\* Else:



&nbsp; \* optional best-effort dedupe:



&nbsp;   \* if same `content\_sha256` inserted in same pot within last N seconds, return existing entry

&nbsp;   \* keep N small (e.g., 30–120s) and document it

\* Update pot `last\_used\_at`.

\* Update prefs `last\_pot\_id` to this pot (unless caller opts out).



Response:



```json

{

&nbsp; "created": true,

&nbsp; "entry": { ... },

&nbsp; "deduped": false

}

```



If deduped:



```json

{

&nbsp; "created": false,

&nbsp; "entry": { ...existing... },

&nbsp; "deduped": true,

&nbsp; "reason": "client\_capture\_id" // or "hash\_window"

}

```



---



\### D) Autosave endpoint (optional but useful)



If autosave is enabled, the popup (or background UI) can just send without waiting for confirmation.



\#### `POST /capture/text/auto`



\* Same body as `/capture/text`

\* Server checks autosave rules:



&nbsp; \* global enabled OR pot override true

\* If autosave not enabled:



&nbsp; \* return `409` with a structured error: “autosave\_disabled”



This keeps autosave logic server-authoritative.



---



\## Storage Layer Changes



Add repos:



\* `prefsRepo`:



&nbsp; \* `getCapturePrefs()`

&nbsp; \* `setCapturePrefsPatch(patch)`

\* update `potsRepo`:



&nbsp; \* `touchLastUsed(potId, ts)`

\* update `entriesRepo`:



&nbsp; \* `insertTextEntryIdempotent(...)`



Transaction rules:



\* capture insert + pot touch + audit event should be in one transaction.



---



\## Audit Events (Phase 3)



Log the following actions:



\* `prefs\_update\_capture`

\* `capture\_text\_created`

\* `capture\_text\_deduped`

\* `pot\_last\_used\_updated`



Store metadata:



\* pot\_id, entry\_id, capture\_method, source\_url presence, dedupe reason, client\_capture\_id presence (not necessarily the full id)



---



\## Validation Rules (do not skip)



\* `text` must be non-empty after trim.

\* `pot\_id` must exist.

\* `captured\_at` must be reasonable (allow client clock drift, but reject absurd values).

\* `client\_capture\_id` max length enforced.



---



\## Tests (Phase 3)



\### Unit tests



\* prefs merge/patch logic

\* dedupe decision logic

\* pot sorting logic (if implemented in code instead of SQL)



\### Integration tests (required)



1\. `PUT /prefs/capture` then `GET /prefs/capture` returns expected values.

2\. `POST /capture/text` with `client\_capture\_id` twice:



&nbsp;  \* first returns created=true

&nbsp;  \* second returns created=false, deduped=true and same entry id

3\. `GET /capture/pots` sorts by last\_used\_at after captures.

4\. Autosave behavior:



&nbsp;  \* disabled -> 409

&nbsp;  \* enabled -> 200 and entry created



---



\## Smoke Script (Phase 3)



`scripts/smoke-phase3.(sh|ps1)`:



1\. create 2 pots

2\. set default pot

3\. call `/capture/pots` and verify ordering

4\. capture text with client\_capture\_id

5\. repeat capture and verify dedupe response

6\. enable autosave and run `/capture/text/auto`

7\. list entries and print counts



Exit non-zero if any step fails.



---



\## QA Steps (Manual)



1\. Reset DB and migrate:



\* `pnpm db:reset`

\* `pnpm db:migrate`



2\. Run:



\* `pnpm dev`



3\. Pot picker:



\* `curl http://localhost:<port>/capture/pots`



4\. Set prefs:



\* `curl -X PUT http://localhost:<port>/prefs/capture -H "content-type: application/json" -d '{...}'`



5\. Capture:



\* `curl -X POST http://localhost:<port>/capture/text -H "content-type: application/json" -d '{...}'`



6\. Retry same capture:



\* run again; confirm dedupe.



---



\## Git Commit Plan (Phase 3)



1\. `feat(storage): add user\_prefs table and pot last\_used\_at`

2\. `feat(api): add capture pot picker endpoint`

3\. `feat(api): add capture prefs get/put`

4\. `feat(api): add idempotent capture endpoint with client\_capture\_id`

5\. `test(api): add phase 3 integration tests and smoke script`

6\. `docs: update api and qa and changelog for phase 3`



---



\## Phase 3 Exit Criteria Checklist



\* \[ ] `/capture/pots` works and sorts by recency

\* \[ ] prefs persist and are validated

\* \[ ] capture is idempotent via client\_capture\_id

\* \[ ] autosave server-side logic works

\* \[ ] pot last\_used\_at updates correctly

\* \[ ] audit events created

\* \[ ] integration tests + smoke script green

\* \[ ] docs + changelog updated



---



```

```



