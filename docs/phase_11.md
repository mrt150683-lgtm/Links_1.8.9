````md

\# Phase\_11.md — Chrome Extension Bridge (Capture Endpoints + Local Auth + Hardening)



\## Purpose

Phase 11 prepares (and optionally implements) the Chrome extension workflow by delivering a hardened \*\*extension bridge layer\*\* in the backend:

\- right-click capture text selection -> store in pot

\- right-click save image -> store as asset + link to pot

\- save page metadata (url/title) -> store as link entry

\- optional: “capture screenshot” placeholder (extension-side later)

\- \*\*local-only\*\* endpoints + strict auth + origin controls + rate limits

\- fully testable with curl (simulate extension requests)



This phase is backend-first: you can build the extension later without changing the backend contract.



---



\## Definition of Done

Phase 11 is complete only when:



\### ✅ Extension endpoints exist and are stable

\- Text selection capture endpoint works.

\- Image capture endpoint works (either by direct upload or by fetch-by-url with restrictions).

\- Page metadata capture endpoint works.



\### ✅ Security controls are real

\- Backend binds to `127.0.0.1` by default.

\- Extension endpoints require a token (rotatable).

\- Strict origin checks / allowlist are enforced (as much as local calls allow).

\- Rate limits prevent abuse.

\- Requests are validated and size-limited.



\### ✅ Dedupe \& idempotency

\- Extension capture supports `client\_capture\_id`.

\- Asset dedupe by sha256 still applies.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - token required

&nbsp; - invalid token rejected

&nbsp; - capture works

&nbsp; - rate limit triggers

&nbsp; - image flow stores asset + entry

\- Smoke script simulates extension calls.



\### ✅ Docs updated

\- `docs/security.md` updated with extension threat model + mitigations.

\- `docs/qa.md` updated with curl examples.

\- `CHANGELOG.md` updated.



---



\## Extension Bridge Architecture

Add an `ext` namespace in the API:



\- `apps/api/src/routes/ext/\*`



Design goals:

\- keep extension surface minimal and hardened

\- avoid reusing general endpoints if they’re too permissive

\- reuse shared capture/storage logic internally



---



\## Authentication Model (Phase 11)

\### Token-based local auth

\- Generate a random token (32+ bytes).

\- Store token in:

&nbsp; - OS keychain if possible

&nbsp; - else encrypted config

\- Extension includes token in header:

&nbsp; - `Authorization: Bearer <token>`

&nbsp; - or `X-Ext-Token: <token>`



\### Token rotation endpoint (local-only)

\- `POST /ext/auth/rotate`

\- returns new token once

\- logs only that rotation occurred (not token)



---



\## Network \& Origin Controls

\### Local binding

\- API binds to `127.0.0.1` by default (must already be true).



\### Origin checks

Extension requests may not have “normal” browser origins for local endpoints, so:

\- validate:

&nbsp; - `User-Agent` patterns (optional)

&nbsp; - `Sec-Fetch-Site` (if present)

&nbsp; - enforce token always

\- if you can verify the extension ID:

&nbsp; - check `chrome-extension://<id>` origin (if present)

\- do not rely on origin alone.



---



\## Rate Limiting \& Size Limits

\- Use per-route rate limiting:

&nbsp; - e.g., 60 requests/minute burst per token

\- Enforce body size limits:

&nbsp; - text capture max length (e.g., 200k chars)

&nbsp; - image fetch max bytes (e.g., 10–25MB)

&nbsp; - document upload is not in scope for extension yet unless you want it



---



\## Endpoints (Phase 11)



\### A) Capture text selection

\#### `POST /ext/capture/selection`

Headers:

\- Authorization token



Body:

```json

{

&nbsp; "pot\_id": "uuid",

&nbsp; "text": "selected text",

&nbsp; "client\_capture\_id": "optional",

&nbsp; "captured\_at": 1234567890,



&nbsp; "page": {

&nbsp;   "url": "https://...",

&nbsp;   "title": "..."

&nbsp; },

&nbsp; "selection\_context": {

&nbsp;   "anchor\_text": "optional",

&nbsp;   "surrounding\_text": "optional",

&nbsp;   "frame\_url": "optional"

&nbsp; }

}

````



Behavior:



\* calls internal capture logic (Phase 3 `/capture/text`)

\* capture\_method forced to `extension`

\* source\_url/title set from page object



Response:



```json

{ "created": true, "deduped": false, "entry": { ... } }

```



---



\### B) Capture page as link entry



\#### `POST /ext/capture/page`



Body:



```json

{

&nbsp; "pot\_id": "uuid",

&nbsp; "client\_capture\_id": "optional",

&nbsp; "captured\_at": 1234567890,

&nbsp; "url": "https://...",

&nbsp; "title": "optional",

&nbsp; "excerpt": "optional short summary"

}

```



Stores an entry of type `link` (if link type exists) OR a `text` entry that contains the URL + optional excerpt (if you haven’t implemented link type yet).



Recommendation:



\* add entry type `link` now (small and useful).



---



\### C) Capture image



Two options:



\#### Option 1 (recommended): direct upload



Extension downloads image bytes and uploads to local API.



\#### `POST /ext/capture/image`



Multipart form:



\* `file=@image.png`

\* fields:



&nbsp; \* `pot\_id`

&nbsp; \* `captured\_at`

&nbsp; \* `page\_url` / `page\_title` (optional)

&nbsp; \* `client\_capture\_id` (optional)



Behavior:



\* store asset (Phase 4)

\* create image entry referencing asset

\* provenance: capture\_method=`extension`



\#### Option 2 (convenient but risky): fetch-by-url (restricted)



\#### `POST /ext/capture/imageByUrl`



Body:



```json

{

&nbsp; "pot\_id": "uuid",

&nbsp; "image\_url": "https://...",

&nbsp; "page\_url": "optional",

&nbsp; "page\_title": "optional",

&nbsp; "captured\_at": 1234567890

}

```



Restrictions (mandatory if implemented):



\* allow only `https://`

\* deny private IP ranges (SSRF defense)

\* enforce max download size

\* enforce allowed content-types (`image/\*`)

\* timeout aggressively



Recommendation:



\* implement \*\*direct upload\*\* first; add fetch-by-url only if needed.



---



\## Data Model Changes (Phase 11)



\### Entry types



If not already present, add `link` entry type:



\* `entries.type` enum: `text | image | doc | link`

\* `entries.link\_url` (TEXT, nullable)

\* `entries.link\_title` (TEXT, nullable)

\* `content\_text` optional for link excerpt



If you prefer not to extend schema now:



\* store as text entry with structured metadata in `source\_context\_json`.

&nbsp; But `link` type is cleaner and makes later search/export easier.



---



\## Worker/Pipeline Triggers



When extension creates:



\* text selection entry: same as Phase 7 pipeline (tags/entities/summary)

\* link entry: also run tagging/entities/summary

\* image entry: do not AI-process yet unless you add OCR/vision later



---



\## Audit Events (Phase 11)



\* `ext\_token\_rotated`

\* `ext\_capture\_selection`

\* `ext\_capture\_page`

\* `ext\_capture\_image`

&nbsp; Include:

\* pot\_id, entry\_id, asset\_id (if applicable), page\_url domain, request\_id



Do NOT store full URLs in audit if “public mode” policies are strict—your call.



---



\## Tests (Phase 11)



\### Unit tests



\* token validator

\* rate limiter config

\* SSRF guard (if imageByUrl implemented)

\* payload validation schemas



\### Integration tests (required)



1\. token missing -> 401

2\. token invalid -> 401

3\. selection capture -> entry created

4\. selection dedupe -> second call deduped

5\. image upload -> asset + image entry created

6\. rate limit -> 429 after threshold



\### Smoke script



`scripts/smoke-phase11.(sh|ps1)`:



\* rotates/loads token (or reads from config)

\* creates pot

\* calls `/ext/capture/selection`

\* uploads image

\* lists entries, asserts expected types exist



---



\## QA Steps (Manual)



1\. Rotate token:



\* `curl -X POST http://localhost:<port>/ext/auth/rotate -H "Authorization: Bearer <old>"`



2\. Capture selection:



\* `curl -X POST http://localhost:<port>/ext/capture/selection -H "Authorization: Bearer <token>" -H "content-type: application/json" -d '{...}'`



3\. Upload image:



\* `curl -X POST http://localhost:<port>/ext/capture/image -H "Authorization: Bearer <token>" -F "file=@./test.png" -F "pot\_id=<id>"`



---



\## Git Commit Plan (Phase 11)



1\. `feat(ext): add extension auth token + rotation endpoint`

2\. `feat(ext): add selection and page capture endpoints`

3\. `feat(ext): add image upload capture endpoint using asset store`

4\. `feat(ext): add rate limiting and request size limits`

5\. `test(ext): add phase 11 integration tests + smoke script`

6\. `docs: update security, qa, changelog for phase 11`



---



\## Phase 11 Exit Criteria Checklist



\* \[ ] extension endpoints implemented and validated

\* \[ ] token auth enforced and rotatable

\* \[ ] rate limits and size limits enforced

\* \[ ] image upload capture works (asset + entry)

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



