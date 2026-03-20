````md

\# Phase\_4.md — Asset Store (Images + Documents as Encrypted Blobs) + DB Linking



\## Purpose

Phase 4 adds support for \*\*binary assets\*\* (images + documents) and connects them to pots and entries in a clean, secure, deduplicated way.



This phase delivers:

\- a robust \*\*asset store\*\* (encrypted-at-rest blobs)

\- \*\*hash-based dedupe\*\* (sha256)

\- \*\*upload + reference\*\* workflow (asset registry + entry linking)

\- doc/image entries stored as \*\*metadata + asset pointers\*\*

\- testable end-to-end ingestion for:

&nbsp; - image upload -> image entry

&nbsp; - document upload -> doc entry



No AI extraction yet (that’s Phase 7+). We only store reliably and securely.



---



\## Definition of Done

Phase 4 is complete only when:



\### ✅ Asset store works

\- Uploading a file stores an encrypted blob on disk.

\- The DB stores metadata including sha256, size, mime type, created\_at.

\- Uploading the same file twice does not duplicate storage (dedupe by sha256).



\### ✅ Entries can reference assets

\- You can create:

&nbsp; - `image` entry (references one asset)

&nbsp; - `doc` entry (references one asset)

\- You can query entries and see linked asset metadata.



\### ✅ Security baseline

\- Assets are encrypted at rest (AEAD).

\- Export of pots is not in scope yet, but files should be designed for export later.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - upload -> create entry -> fetch/list -> verify metadata

&nbsp; - dedupe behavior

&nbsp; - tamper detection (at least detect wrong hash / wrong decrypt)

\- Smoke script exists for Phase 4.



\### ✅ Docs

\- `docs/security.md` updated (asset encryption details).

\- `docs/architecture.md` updated (asset store).

\- `docs/qa.md` updated (upload QA).

\- `CHANGELOG.md` updated.



---



\## Design Decisions



\### 1) Storage layout (local-first)

Use a stable path layout under a single data root, e.g.:

\- `DATA\_DIR/`

&nbsp; - `pots/`

&nbsp;   - `<potId>/`

&nbsp;     - `assets/`

&nbsp;       - `<sha256>.blob`



\*\*Note:\*\* Even though assets are stored under pot dirs, dedupe is easier if you store globally:

\- `DATA\_DIR/assets/<sha256>.blob`



Recommendation: \*\*global asset pool\*\* + pot references in DB.

It simplifies dedupe and reduces duplication across pots.



\### 2) Encryption

Assets are stored as encrypted blobs using AEAD (e.g., XChaCha20-Poly1305 or AES-256-GCM).



Minimum viable in Phase 4:

\- one \*\*app-level encryption key\*\* (from config/OS keychain)

\- per-asset random nonce

\- encrypted blob format contains a small header:

&nbsp; - version

&nbsp; - nonce

&nbsp; - ciphertext

&nbsp; - tag



Later phases can evolve to per-pot keys and envelope encryption; Phase 4 must not paint you into a corner.



\### 3) Hashing

Compute sha256 on \*\*raw bytes\*\* of the uploaded file (before encryption).

Store `sha256\_hex`.



Upload flow:

1\) read bytes

2\) compute sha256

3\) if asset exists by sha256 -> reuse (no rewrite)

4\) else encrypt bytes -> write blob

5\) insert asset record



---



\## Data Model Additions (Phase 4)



\### 1) `assets` table

Table: `assets`

\- `id` (TEXT uuid)

\- `sha256` (TEXT unique, required)

\- `size\_bytes` (INTEGER, required)

\- `mime\_type` (TEXT, required)

\- `original\_filename` (TEXT, optional)

\- `storage\_path` (TEXT, required) — relative path to blob

\- `encryption\_version` (INTEGER, default 1)

\- `created\_at` (INTEGER epoch ms)



Indexes:

\- `uq\_assets\_sha256` (unique)

\- `idx\_assets\_created\_at`



\### 2) Extend `entries` to support asset-backed types

In Phase 2, entries were text-only. Now add:

\- `type` enum expands: `text | image | doc`

\- `asset\_id` (TEXT FK -> assets.id, nullable)

\- `content\_text` becomes nullable (only for text)

\- `content\_sha256` remains required for text entries, nullable for asset types (or store separately)



Recommended rule:

\- For `image` and `doc` entries:

&nbsp; - `asset\_id` is required

&nbsp; - `content\_text` is null

&nbsp; - store `asset\_sha256` in entry as convenience (optional; derived from asset)



Add constraints:

\- CHECK:

&nbsp; - if `type='text'` then `content\_text` not null and `content\_sha256` not null

&nbsp; - if `type in ('image','doc')` then `asset\_id` not null



SQLite doesn’t enforce complex CHECK as strongly as Postgres, but we can still implement and also enforce at API layer.



\### 3) `entry\_assets` (optional)

If you want multi-asset entries later (doc with thumbnails), consider join table:

\- `entry\_assets(entry\_id, asset\_id, role)`

For Phase 4: keep it 1:1 via `entries.asset\_id` to reduce complexity.



---



\## Storage Layer Changes

Add `assetsRepo`:

\- `getBySha256(sha256)`

\- `insertAsset(...)`

\- `getAssetById(id)`

\- `listAssetsByPot(potId)` (optional)

Add `assetStore` module:

\- `writeEncrypted(sha256, bytes) -> storage\_path`

\- `readDecrypted(storage\_path) -> bytes` (used for future download; minimal now)

\- `verifyDecrypt(...)` (optional test helper)



---



\## API (Phase 4)



\### A) Upload asset

\#### `POST /pots/:potId/assets`

Multipart upload recommended (or base64 JSON for simple MVP—multipart is better).



Request (multipart):

\- `file` (binary)

\- optional fields:

&nbsp; - `original\_filename`

&nbsp; - `captured\_at`

&nbsp; - `source\_url`

&nbsp; - `source\_title`

&nbsp; - `capture\_method` (e.g., `upload`, `extension`)



Response:

```json

{

&nbsp; "created": true,

&nbsp; "asset": {

&nbsp;   "id": "...",

&nbsp;   "sha256": "...",

&nbsp;   "size\_bytes": 123,

&nbsp;   "mime\_type": "image/png",

&nbsp;   "created\_at": 123

&nbsp; },

&nbsp; "deduped": false

}

````



If deduped:



```json

{

&nbsp; "created": false,

&nbsp; "asset": { ...existing... },

&nbsp; "deduped": true,

&nbsp; "reason": "sha256"

}

```



Notes:



\* Pot id is included mainly for auditing + future per-pot keys. The asset itself may live in a global pool.



\### B) Create image entry



\#### `POST /pots/:potId/entries/image`



Body:



```json

{

&nbsp; "asset\_id": "uuid",

&nbsp; "capture\_method": "upload",

&nbsp; "captured\_at": 1234567890,

&nbsp; "source\_url": "https://...",

&nbsp; "source\_title": "...",

&nbsp; "notes": "optional",

&nbsp; "client\_capture\_id": "optional-idempotency"

}

```



Behavior:



\* validate asset exists

\* entry references asset

\* update pot `last\_used\_at`

\* idempotent if `client\_capture\_id` provided



\### C) Create doc entry



\#### `POST /pots/:potId/entries/doc`



Same as image entry, but type `doc`.



\### D) Fetch entry includes asset metadata



\#### `GET /entries/:entryId`



Return:



\* entry + if asset-backed, embed asset metadata (id, sha256, mime, size)



\### E) Optional: list assets for pot



\#### `GET /pots/:potId/assets`



Returns asset metadata linked to entries in that pot.



---



\## Validation Rules



\* Upload rejects:



&nbsp; \* empty file

&nbsp; \* files over configured max size (`ASSET\_MAX\_BYTES`)

&nbsp; \* unknown mime if you choose to restrict (optional)

\* Entry creation rejects:



&nbsp; \* missing asset\_id

&nbsp; \* asset not found

&nbsp; \* wrong pot\_id (optional check: ensure asset is “allowed” for pot; for now allow global usage)



---



\## Security Requirements (Phase 4)



\* API binds to localhost by default (still true).

\* Asset blobs are encrypted with AEAD.

\* Logs do not include raw file bytes or decrypted contents.

\* Store only minimal metadata unless explicitly required.



Update `docs/security.md` with:



\* encryption primitive choice

\* key storage method

\* blob format versioning



---



\## Tests (Phase 4)



\### Unit tests



\* sha256 of bytes stable

\* encryption roundtrip:



&nbsp; \* encrypt -> decrypt -> equals original bytes

\* blob header parsing (version, nonce length, etc.)



\### Integration tests (required)



1\. Upload asset:



&nbsp;  \* returns asset metadata

&nbsp;  \* DB row exists

&nbsp;  \* blob file exists

2\. Dedupe:



&nbsp;  \* upload same file twice returns deduped=true second time

&nbsp;  \* blob file not duplicated

3\. Create image entry:



&nbsp;  \* references asset

&nbsp;  \* `GET /entries/:id` includes asset metadata

4\. Create doc entry similarly

5\. Tamper detection (minimum):



&nbsp;  \* modify blob bytes -> decrypt fails OR hash mismatch is detected (whichever is implemented)



---



\## Smoke Script (Phase 4)



`scripts/smoke-phase4.(sh|ps1)`:



1\. create pot

2\. upload sample image file

3\. create image entry referencing asset

4\. upload sample pdf

5\. create doc entry

6\. fetch entries and verify asset metadata included

7\. upload same image again and verify dedupe response



Exit non-zero if any step fails.



---



\## QA Steps (Manual)



1\. Run API: `pnpm dev`

2\. Create pot (Phase 2 command)

3\. Upload file (multipart):



\* `curl -X POST http://localhost:<port>/pots/<potId>/assets -F "file=@./test.png"`



4\. Create image entry:



\* `curl -X POST http://localhost:<port>/pots/<potId>/entries/image -H "content-type: application/json" -d '{"asset\_id":"...","capture\_method":"upload","captured\_at":<now>}'`



5\. Fetch entry:



\* `curl http://localhost:<port>/entries/<entryId>`



---



\## Git Commit Plan (Phase 4)



1\. `feat(storage): add assets table and migrations`

2\. `feat(storage): add encrypted asset store module`

3\. `feat(api): add asset upload endpoint with sha256 dedupe`

4\. `feat(api): add image/doc entry endpoints referencing assets`

5\. `test(api): add phase 4 integration tests and smoke script`

6\. `docs: update security, architecture, qa, changelog for phase 4`



---



\## Phase 4 Exit Criteria Checklist



\* \[ ] encrypted blobs written and readable (roundtrip test)

\* \[ ] asset registry dedupes by sha256

\* \[ ] image/doc entries reference assets correctly

\* \[ ] entry fetch returns asset metadata

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



