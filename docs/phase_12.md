````md

\# Phase\_12.md — Hardening, Search, and “Ship It” (Stability + UX-Ready Backend)



\## Purpose

Phase 12 is the “make it unkillable” phase:

\- \*\*search\*\* (fast, useful, and testable)

\- \*\*performance hardening\*\* (indexes, WAL tuning, job throttling)

\- \*\*operational polish\*\* (backup strategy, health diagnostics, safe upgrades)

\- \*\*security hardening\*\* (final threat review, secret handling, logging redaction)

\- \*\*developer ergonomics\*\* (one-command QA, fixtures, reproducible environments)



This phase doesn’t add shiny features. It makes the backend reliable enough that UI work doesn’t become a bug-hunt horror show.



---



\## Definition of Done

Phase 12 is complete only when:



\### ✅ Search is useful

\- You can search within a pot by:

&nbsp; - text content

&nbsp; - tags

&nbsp; - entities

&nbsp; - link URL/title (if link entries exist)

\- Search is fast enough for thousands of entries.

\- Results include:

&nbsp; - entry id

&nbsp; - preview snippet

&nbsp; - relevance ordering (even if basic)



\### ✅ Diagnostics are strong

\- `/health` expands to include:

&nbsp; - db connectivity

&nbsp; - migration version

&nbsp; - worker status (last heartbeat if implemented)

&nbsp; - model registry fetched\_at

\- Logs are structured and consistent across API/worker/mcp.



\### ✅ Reliability hardening complete

\- Job engine:

&nbsp; - lock timeout reclaim verified

&nbsp; - deadletter tooling exists

&nbsp; - manual requeue exists

\- Asset store:

&nbsp; - integrity checks runnable

&nbsp; - storage cleanup strategy defined (no orphan blobs)



\### ✅ Security review completed

\- Extension endpoints hardened

\- Export/import hardened

\- No secrets in logs

\- Default local-only binding

\- Rate limits in place



\### ✅ “One command QA”

\- A single script runs:

&nbsp; - db reset/migrate

&nbsp; - start api + worker (test mode)

&nbsp; - run smoke tests for phases 2–11

&nbsp; - stop services

\- CI runs this suite in reduced form.



\### ✅ Docs finalized

\- `docs/qa.md` updated to “single source of truth”

\- `docs/security.md` updated with final threat + mitigations

\- `docs/architecture.md` updated with final component map

\- `CHANGELOG.md` updated with Phase 12 completion



---



\## Search Design (Phase 12)



\### Option A (recommended for SQLite): FTS5

Use SQLite FTS5 virtual table for full-text search.



Create:

\- `entries\_fts` virtual table indexing:

&nbsp; - entry text content

&nbsp; - link title/url (if present)

&nbsp; - derived summary (optional)

\- Maintain via triggers or application updates.



Pros:

\- fast

\- local-first

\- no extra infra



Cons:

\- requires careful sync with entries table



\### Option B: “like” + basic indexes

Works for small datasets but scales badly.

Not recommended if you want “real research” usage.



\*\*Phase 12 recommendation: FTS5.\*\*



---



\## Data Model Additions (Phase 12)



\### 1) FTS table

`entries\_fts`:

\- `entry\_id`

\- `pot\_id`

\- `content`

\- `title` (optional)



Triggers:

\- insert/update/delete on entries updates FTS.



\### 2) Worker heartbeat (optional but helpful)

`worker\_status`:

\- `worker\_id` (TEXT primary key)

\- `last\_heartbeat\_at` (INTEGER)

\- `status` (`running|idle|stopped`)

\- `current\_job\_id` (nullable)



---



\## API Additions (Phase 12)



\### A) Search endpoint

\#### `GET /pots/:potId/search`

Query:

\- `q` (string)

\- `limit`, `offset`

\- filters:

&nbsp; - `type` (text/image/doc/link)

&nbsp; - `min\_confidence` for links/artifacts (optional)

&nbsp; - `has\_assets` (optional)



Response:

```json

{

&nbsp; "q": "string",

&nbsp; "results": \[

&nbsp;   {

&nbsp;     "entry\_id": "...",

&nbsp;     "type": "text",

&nbsp;     "snippet": "...",

&nbsp;     "score": 12.34,

&nbsp;     "captured\_at": 123,

&nbsp;     "source\_url": "optional"

&nbsp;   }

&nbsp; ]

}

````



\### B) Diagnostics



\#### `GET /diagnostics`



Returns:



\* db path

\* WAL mode

\* migration version

\* model registry age

\* job queue stats:



&nbsp; \* queued/running/failed/dead counts

\* asset store stats:



&nbsp; \* blob count

&nbsp; \* orphan count (if implemented)



\### C) Job admin tooling



\* `POST /jobs/:id/requeue`

\* `POST /jobs/requeue-dead` (filtered)

\* `GET /jobs/dead` convenience endpoint



\### D) Asset admin tooling



\* `POST /assets/verify` (runs integrity checks; may enqueue a job)

\* `POST /assets/cleanup-orphans` (dry-run first, then real)



---



\## Performance Hardening Tasks



\### DB pragmas and tuning



\* WAL mode enforced

\* `synchronous=NORMAL` (document tradeoffs)

\* indexes validated via explain plans for hot paths:



&nbsp; \* entries by pot + time

&nbsp; \* artifacts by entry + type

&nbsp; \* links by pot + confidence

&nbsp; \* jobs by status + run\_after



\### Query constraints



\* pagination everywhere

\* limits enforced server-side



\### Worker throttling



\* max concurrent jobs configurable

\* backoff/jitter tuned

\* run windows respected



---



\## Security Hardening Tasks



\* Full audit of:



&nbsp; \* export/import passphrase handling

&nbsp; \* extension token rotation and storage

&nbsp; \* SSRF defenses (if any fetch-by-url exists)

&nbsp; \* logging redaction for headers/body

\* Add a “security self-test” script:



&nbsp; \* ensures server not bound publicly

&nbsp; \* ensures token required on /ext routes

&nbsp; \* ensures secrets not printed (basic grep checks)



---



\## Operational / Upgrade Plan



\### Backup strategy



\* periodic DB copy (safe copy while WAL)

\* include assets directory snapshot

\* document recommended schedule



\### Migration safety



\* migrations are forward-only

\* `db:migrate` prints current version

\* “downgrade” is not supported (document it)



\### Crash recovery



\* worker lock reclaim verified

\* deadletter queue inspectable



---



\## Tests (Phase 12)



\### Unit tests



\* FTS indexing triggers correct

\* search ranking returns expected ordering for fixtures

\* diagnostics schema stable



\### Integration tests (required)



1\. Create pot + entries -> search returns expected results.

2\. Derived artifacts optionally included in search if you choose to index summaries.

3\. Insert dead job -> requeue endpoint works.

4\. Asset integrity verification job returns ok for known assets.



\### End-to-end “one command QA”



Add `scripts/qa-all.(sh|ps1)`:



\* reset/migrate DB

\* run API+worker in test mode

\* run smoke scripts:



&nbsp; \* phase2, phase3, phase4, phase5, phase6, phase7, phase8, phase9, phase10, phase11

\* stop services

\* report pass/fail summary



CI should run:



\* unit + integration tests always

\* QA-all in nightly or on main merge (depending on runtime)



---



\## Documentation Finalization



Update docs:



\* `docs/qa.md` becomes the canonical “how to validate the system”

\* `docs/security.md` includes final threat model + decisions

\* `docs/architecture.md` includes final diagrams (even ascii) + module boundaries

\* `docs/pipeline.md` finalized job list and artifact/link formats



---



\## Git Commit Plan (Phase 12)



1\. `feat(search): add sqlite fts5 index and search endpoint`

2\. `feat(diagnostics): add diagnostics endpoint and health expansion`

3\. `feat(admin): add job requeue/deadletter tooling`

4\. `feat(admin): add asset verify + orphan cleanup (dry-run first)`

5\. `test(e2e): add qa-all script and integration tests`

6\. `docs: finalize qa/security/architecture/pipeline + changelog`



---



\## Phase 12 Exit Criteria Checklist



\* \[ ] pot search works and is fast (FTS5)

\* \[ ] diagnostics endpoint provides actionable state

\* \[ ] deadletter + requeue tooling works

\* \[ ] asset integrity + cleanup tooling works (with dry-run)

\* \[ ] one-command QA script passes

\* \[ ] final security review recorded in docs

\* \[ ] docs + changelog updated



---



```

```



