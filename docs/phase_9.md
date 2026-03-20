```md

\# Phase\_9.md — Secure Pot Export / Import (Shareable Bundles + Integrity Verification)



\## Purpose

Phase 9 enables the “share a research pot safely” feature:

\- export a pot (entries + derived artifacts + links + assets) into a \*\*portable encrypted bundle\*\*

\- import a bundle to recreate the pot locally

\- integrity verification via hashes + manifest

\- optional “public share mode” to strip sensitive metadata



This phase is critical because it forces the data model to be genuinely coherent.



---



\## Definition of Done

Phase 9 is complete only when:



\### ✅ Export works

\- You can export a pot by id and produce a single bundle file.

\- Bundle is encrypted.

\- Bundle contains:

&nbsp; - pot metadata

&nbsp; - entries (text + metadata)

&nbsp; - assets (encrypted blobs)

&nbsp; - derived artifacts

&nbsp; - links

&nbsp; - audit subset (optional, but recommended)

&nbsp; - manifest with hashes and schema versions



\### ✅ Import works

\- Importing the bundle recreates the pot and all contained records.

\- Asset hashes match.

\- Derived artifacts and links are restored.

\- Import refuses tampered bundles.



\### ✅ Security is real

\- Export bundles are always encrypted.

\- Import validates integrity before ingesting data.

\- No secrets are stored in the bundle.



\### ✅ Tests \& QA

\- Integration test: export -> import -> counts/hashes match

\- Tamper test: modify bundle -> import fails

\- Smoke script: export/import end-to-end



\### ✅ Docs updated

\- `docs/security.md` updated (bundle encryption + threat notes)

\- `docs/qa.md` updated (commands)

\- `CHANGELOG.md` updated



---



\## Bundle Format (Design)

\### High-level

A bundle is a single file, e.g.:

\- `pot\_<name>\_<date>.lynxpot` (or `.links-pot`, pick later)



Internally it is:

\- an encrypted container containing a tar/zip structure



\### Container strategy (recommended)

\- Create a \*\*tar\*\* (or zip) directory structure

\- Compute manifest hashes

\- Encrypt the whole archive as one blob (simplest, safest)



Later optimization (optional):

\- encrypt individual files, but Phase 9 should prioritize correctness.



---



\## Bundle Contents

Inside the decrypted archive:



```



/manifest.json

/pot.json

/data/

entries.json

assets.json

artifacts.json

links.json

audit.json        (optional)

/assets/ <sha256>.blob     (the encrypted asset blobs as stored by your asset store)



````



\### 1) `manifest.json`

Contains:

\- bundle format version

\- created\_at

\- app version

\- pot\_id (source)

\- export options (public/private)

\- hashes for each included file

\- per-asset sha256 list



Example fields:

```json

{

&nbsp; "format\_version": 1,

&nbsp; "created\_at": 123,

&nbsp; "app\_version": "0.1.0",

&nbsp; "export\_mode": "private",

&nbsp; "files": {

&nbsp;   "pot.json": { "sha256": "..." },

&nbsp;   "data/entries.json": { "sha256": "..." }

&nbsp; },

&nbsp; "assets": \[

&nbsp;   { "sha256": "...", "size\_bytes": 123, "path": "assets/<sha256>.blob" }

&nbsp; ]

}

````



\### 2) `pot.json`



Contains pot metadata:



\* name, description

\* created\_at

\* (optionally) original pot id



\### 3) `data/\*.json`



Store records as arrays with schema version fields.

Important rule:



\* preserve original IDs in export data, but on import you may map to new ids.



---



\## ID Mapping Strategy (Import)



Two sane options:



\### Option A (recommended): preserve IDs



\* If there is no collision, keep IDs as-is.

\* If collision occurs, remap and keep a mapping table in memory.



Pros: easier to keep links/artifacts consistent.

Cons: collisions possible if importing same pot twice.



\### Option B: always remap IDs



\* Generate new ids on import and map everything.



Pros: no collisions ever.

Cons: slightly more complex.



Recommendation: \*\*Option B always remap\*\*, and store a mapping dictionary while importing:



\* old\_pot\_id -> new\_pot\_id

\* old\_entry\_id -> new\_entry\_id

\* old\_asset\_id -> new\_asset\_id

\* old\_artifact\_id -> new\_artifact\_id

\* old\_link\_id -> new\_link\_id



This prevents “import same bundle twice” issues.



---



\## Encryption Model (Phase 9)



\### Key derivation



Bundle encryption key derived from:



\* user passphrase (entered at export/import)

\* Argon2id KDF params stored in manifest header (unencrypted)



\### Encryption primitive



\* AEAD (XChaCha20-Poly1305 or AES-256-GCM)

\* Nonce + salt stored in a small unencrypted header



\### Bundle header (unencrypted)



`bundle\_header.json` outside encrypted payload (or prefixed bytes) includes:



\* format\_version

\* kdf params (salt, memory, iterations)

\* nonce

\* cipher

\* encrypted\_payload\_length



No sensitive content in header.



---



\## Export Flow (Phase 9)



\### Steps



1\. Validate pot exists.

2\. Gather records:



&nbsp;  \* pot

&nbsp;  \* entries in pot

&nbsp;  \* assets referenced by entries

&nbsp;  \* derived artifacts for entries

&nbsp;  \* links in pot

&nbsp;  \* (optional) audit events for pot

3\. Apply export mode transform:



&nbsp;  \* `private` keeps everything

&nbsp;  \* `public` strips:



&nbsp;    \* source\_url (optional)

&nbsp;    \* source\_title (optional)

&nbsp;    \* notes (optional)

&nbsp;    \* audit events (optional)

&nbsp;    \* any user prefs references

4\. Write JSON files to temp folder.

5\. Copy required asset blobs to `/assets/`.

6\. Compute sha256 for each file + build manifest.

7\. Create tar/zip.

8\. Encrypt tar/zip into final bundle file.

9\. Emit audit event: `pot\_exported`.



\### Export API/CLI



Provide both:



\* API endpoint: `POST /pots/:potId/export`

\* CLI command: `pnpm pot:export --pot <id> --out <path> --mode private`



---



\## Import Flow (Phase 9)



1\. Read bundle header.

2\. Derive key from passphrase + kdf params.

3\. Decrypt payload to temp archive.

4\. Read `manifest.json`.

5\. Verify sha256 of all included files match manifest.

6\. Verify assets listed exist and hash matches expected file name (sha256).

7\. Parse pot and data JSON files with schema validation.

8\. Remap IDs and insert in a transaction:



&nbsp;  \* insert pot

&nbsp;  \* insert assets (asset registry rows) + copy blobs into local asset store (dedupe)

&nbsp;  \* insert entries referencing mapped asset ids

&nbsp;  \* insert derived artifacts referencing mapped entry ids

&nbsp;  \* insert links referencing mapped entry ids

9\. Emit audit event: `pot\_imported`.



Failure rules:



\* any hash mismatch -> abort with clear error, no partial import

\* any schema mismatch -> abort

\* any missing file -> abort



---



\## API (Phase 9)



\### A) Export



\#### `POST /pots/:potId/export`



Body:



```json

{

&nbsp; "mode": "private|public",

&nbsp; "bundle\_name": "optional",

&nbsp; "passphrase\_hint": "optional"

}

```



Response:



```json

{

&nbsp; "ok": true,

&nbsp; "bundle\_path": "local filesystem path or token reference"

}

```



Note: Since you’re local-first, returning a local path is acceptable. If you prefer, return an export job id and store the bundle in a known export directory.



\### B) Import



\#### `POST /pots/import`



Body:



```json

{

&nbsp; "bundle\_path": "/path/to/file",

&nbsp; "passphrase": "provided by user",

&nbsp; "import\_as\_name": "optional override"

}

```



Response:



```json

{

&nbsp; "ok": true,

&nbsp; "pot\_id": "new\_pot\_id",

&nbsp; "stats": { "entries": 10, "assets": 3, "artifacts": 20, "links": 5 }

}

```



\### C) Export/Import can be jobs



For large pots, export/import should be run via processing jobs:



\* `export\_pot`

\* `import\_pot`



Phase 9 baseline:



\* allow synchronous for small pots

\* use job system for large by size threshold



---



\## Storage Layer Changes (Phase 9)



Add `exportImportService` in `packages/core` or `packages/storage`:



\* `exportPot(potId, options) -> bundlePath`

\* `importPot(bundlePath, passphrase, options) -> newPotId`



Add helpers:



\* `manifestBuilder`

\* `bundleEncryptor`

\* `bundleDecryptor`



Ensure:



\* temp directories cleaned up even on failure



---



\## Audit Events (Phase 9)



\* `pot\_export\_requested`

\* `pot\_exported` (include mode, counts, bundle hash)

\* `pot\_import\_requested`

\* `pot\_imported` (include counts, source bundle hash)

\* `pot\_import\_failed` (include reason)



---



\## Tests (Phase 9)



\### Unit tests



\* manifest hashing: stable sha256 computation for files

\* encryption/decryption roundtrip for bundle

\* schema parsing for `entries.json` etc.

\* ID remapping correctness



\### Integration tests (required)



1\. Build a pot with:



&nbsp;  \* 2 text entries

&nbsp;  \* 1 image asset entry

&nbsp;  \* 1 derived artifact (mock)

&nbsp;  \* 1 link (mock)

2\. Export pot -> verify bundle file exists.

3\. Import bundle -> verify:



&nbsp;  \* pot exists

&nbsp;  \* counts match

&nbsp;  \* asset blobs exist

4\. Tamper test:



&nbsp;  \* flip 1 byte in encrypted payload or manifest

&nbsp;  \* import fails with integrity error



\### Smoke script



`scripts/smoke-phase9.(sh|ps1)`:



1\. create pot + entry + upload asset + create entry

2\. export pot (private)

3\. import pot into new pot

4\. list entries in imported pot and assert count matches

5\. print stats



---



\## QA Steps (Manual)



1\. Run API

2\. Create pot and add some entries/assets

3\. Export:



\* `pnpm pot:export --pot <id> --out ./exports --mode private`



4\. Import:



\* `pnpm pot:import --file ./exports/<bundle> --passphrase "..."`



Verify:



\* imported pot exists

\* entries/assets present



---



\## Git Commit Plan (Phase 9)



1\. `feat(export): add bundle format schemas and manifest builder`

2\. `feat(security): add bundle encryption/decryption helpers`

3\. `feat(export): implement pot export service and CLI`

4\. `feat(import): implement pot import service and CLI`

5\. `test(export): add export/import integration tests incl tamper test`

6\. `docs: update security, qa, changelog for phase 9`



---



\## Phase 9 Exit Criteria Checklist



\* \[ ] export produces encrypted bundle with manifest

\* \[ ] import verifies integrity and recreates pot

\* \[ ] tampered bundle is rejected

\* \[ ] ID remapping prevents collisions

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



