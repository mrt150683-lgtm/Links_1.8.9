\# Phase\_2.md — Storage Layer + Schema (Pots + Entries, Minimal)



\## Purpose

Phase 2 introduces the \*\*data foundation\*\*: a solid, logically designed database schema and a storage layer that supports:

\- creating/listing/updating/deleting \*\*Research Pots\*\*

\- creating/listing/fetching \*\*Text Entries\*\* inside pots

\- mandatory \*\*provenance + integrity hashing\*\*

\- migrations, transactions, and predictable performance



No AI. No background workers. No assets yet (images/docs in Phase 4).



---



\## Definition of Done

Phase 2 is complete only when:



\### ✅ Database \& migrations

\- DB is initialized via migrations (no ad-hoc schema creation).

\- `pnpm db:migrate` applies schema from scratch on an empty DB.

\- `pnpm db:reset` (or equivalent) recreates DB cleanly.



\### ✅ Core entities implemented

\- Pot CRUD works end-to-end.

\- Text Entry CRUD works end-to-end.

\- Entries are always tied to a pot (FK enforced).



\### ✅ Integrity \& provenance

\- Each entry stores:

&nbsp; - `capture\_method`

&nbsp; - `captured\_at`

&nbsp; - `source\_url` (optional)

&nbsp; - `source\_title` (optional)

&nbsp; - canonical content hash (`content\_sha256`)

\- Content hash is \*\*reproducible\*\* and tested.



\### ✅ API + tests

\- API endpoints exist and are schema-validated.

\- Unit + integration tests exist and pass.

\- Smoke script exists to create pot + entry + list them.



\### ✅ Documentation

\- `docs/architecture.md` updated with storage overview.

\- `docs/qa.md` updated with Phase 2 test commands.

\- `CHANGELOG.md` updated with Phase 2 completion.



---



\## Tech Choice (Phase 2 baseline)

\### Database: SQLite (local-first)

Rationale:

\- easiest “backend-first local system” foundation

\- supports WAL mode + good performance for single-user

\- export/import later can ship a pot bundle cleanly



\*\*Design rule:\*\* Storage access must be behind an interface so Postgres is swappable later.



\### DB Library

Pick one (recommendation first):

\- \*\*Kysely\*\* (typed SQL builder) + `better-sqlite3` driver

\- OR `drizzle-orm` with SQLite

\- OR raw SQL with a tiny wrapper (acceptable if consistent + typed schemas)



Phase plan assumes Kysely + better-sqlite3 for speed + deterministic behavior.



---



\## Data Model (Phase 2)

\### 1) Pots

Table: `pots`

\- `id` (TEXT, uuid)

\- `name` (TEXT, required)

\- `description` (TEXT, optional)

\- `security\_level` (TEXT, default `standard`) — placeholder; real encryption config later

\- `created\_at` (INTEGER epoch ms)

\- `updated\_at` (INTEGER epoch ms)



Indexes:

\- `idx\_pots\_updated\_at`



\### 2) Entries (text only)

Table: `entries`

\- `id` (TEXT, uuid)

\- `pot\_id` (TEXT, FK -> pots.id, ON DELETE CASCADE)

\- `type` (TEXT, enum: `text` only for Phase 2)

\- `content\_text` (TEXT, required for text entries)

\- `content\_sha256` (TEXT, required)

\- `capture\_method` (TEXT, required; e.g. `clipboard`, `extension`, `manual`, `import`)

\- `source\_url` (TEXT, optional)

\- `source\_title` (TEXT, optional)

\- `notes` (TEXT, optional)

\- `captured\_at` (INTEGER epoch ms, required)

\- `created\_at` (INTEGER epoch ms)

\- `updated\_at` (INTEGER epoch ms)



Indexes:

\- `idx\_entries\_pot\_id\_captured\_at`

\- `idx\_entries\_pot\_id\_created\_at`

\- (optional) `idx\_entries\_source\_url` for quick filtering later



\### 3) Audit events (minimum viable)

Table: `audit\_events`

\- `id` (TEXT, uuid)

\- `timestamp` (INTEGER epoch ms)

\- `actor` (TEXT; `user`, `system`, `extension`)

\- `action` (TEXT; `create\_pot`, `create\_entry`, etc.)

\- `pot\_id` (TEXT, nullable)

\- `entry\_id` (TEXT, nullable)

\- `metadata\_json` (TEXT, JSON string)



Indexes:

\- `idx\_audit\_events\_timestamp`

\- `idx\_audit\_events\_pot\_id`



\*\*Why now?\*\* Because you \*will\* need it later, and adding audit trails after the fact is pain.



---



\## Storage Layer Design

\### Goals

\- Single module that owns DB lifecycle:

&nbsp; - open DB

&nbsp; - apply pragmas (WAL, foreign keys)

&nbsp; - expose typed query helpers

\- Clean separation:

&nbsp; - API calls storage methods

&nbsp; - storage methods return domain objects

\- Transactions supported for multi-step operations.



\### Proposed package structure

`packages/storage/`

\- `db.ts` — open connection, pragmas, migration runner

\- `migrations/` — versioned SQL migration files

\- `repos/potsRepo.ts`

\- `repos/entriesRepo.ts`

\- `repos/auditRepo.ts`

\- `types.ts` — Kysely table typing

\- `index.ts` — exports



---



\## API (Phase 2)

All request/response bodies use Zod schemas from `packages/core`.



\### Pots

\- `POST /pots`

&nbsp; - body: `{ name, description? }`

&nbsp; - returns: pot object

\- `GET /pots`

&nbsp; - query: optional pagination

&nbsp; - returns: list

\- `GET /pots/:id`

&nbsp; - returns: pot

\- `PATCH /pots/:id`

&nbsp; - body: `{ name?, description? }`

\- `DELETE /pots/:id`

&nbsp; - returns: `{ ok: true }`



\### Entries (text)

\- `POST /pots/:id/entries/text`

&nbsp; - body:

&nbsp;   ```json

&nbsp;   {

&nbsp;     "text": "...",

&nbsp;     "capture\_method": "clipboard",

&nbsp;     "source\_url": "https://...",

&nbsp;     "source\_title": "...",

&nbsp;     "notes": "optional",

&nbsp;     "captured\_at": 1234567890

&nbsp;   }

&nbsp;   ```

&nbsp; - server computes `content\_sha256` from canonical text

&nbsp; - returns: entry object

\- `GET /pots/:id/entries`

&nbsp; - query:

&nbsp;   - `limit`, `offset`

&nbsp;   - optional filters: `capture\_method`, `source\_url`

&nbsp; - returns: list + pagination info

\- `GET /entries/:entryId`

&nbsp; - returns: entry object

\- `DELETE /entries/:entryId`

&nbsp; - returns `{ ok: true }`



\*\*Note:\*\* Keep `GET /entries/:entryId` separate so future cross-pot admin operations are easy.



---



\## Canonical Hashing Rules (Very Important)

\### Why

Hashing must be reproducible across:

\- OS differences

\- newline variants

\- copy/paste quirks



\### Canonicalization (Phase 2 rules)

Before hashing:

1\) Convert CRLF -> LF

2\) Trim trailing whitespace on each line

3\) Collapse 3+ consecutive blank lines down to 2 (optional but recommended)

4\) Trim overall leading/trailing whitespace (optional; pick one behavior and keep it forever)



Then:

\- compute `sha256(utf8\_bytes(canonical\_text))`

\- store lowercase hex string



\### Tests

\- same semantic text with different newlines produces same hash

\- text differing by actual characters produces different hash



---



\## Deliverables (Task List)



\### 1) Add `packages/storage`

\- DB bootstrap (WAL, foreign\_keys=ON)

\- migrations runner

\- repo methods for pots/entries/audit

\- typed return objects



\### 2) Migrations

Create migration files:

\- `001\_init.sql`:

&nbsp; - create tables `pots`, `entries`, `audit\_events`

&nbsp; - indexes

&nbsp; - constraints



\### 3) Add core schemas

In `packages/core`:

\- `PotSchema`

\- `EntrySchema`

\- request schemas for create/update

\- `AuditEventSchema` (optional, minimal)



\### 4) API routes

Implement all Phase 2 endpoints with:

\- validation

\- error mapping:

&nbsp; - pot not found -> 404

&nbsp; - bad payload -> 400

&nbsp; - DB constraint -> 409 (where appropriate)



\### 5) Tests

\#### Unit tests

\- canonical hash function

\- repo methods (optional, but recommended)



\#### Integration tests

\- start API (Fastify inject)

\- apply migrations to temp DB

\- create pot -> create entry -> list -> fetch



\### 6) Smoke script

`scripts/smoke-phase2.(sh|ps1)`:

\- creates pot

\- creates entry

\- lists pots

\- lists entries

\- prints results

\- exits non-zero if anything fails



\### 7) Docs updates

\- update `docs/architecture.md` with storage layer

\- update `docs/qa.md` with Phase 2 steps

\- update `CHANGELOG.md`



---



\## QA Steps (Manual)

1\) Fresh DB:

\- `pnpm db:reset`

\- `pnpm db:migrate`



2\) Run API:

\- `pnpm dev`



3\) Create pot:

\- `curl -X POST http://localhost:<port>/pots -H "content-type: application/json" -d '{"name":"Test Pot"}'`



4\) Create entry:

\- `curl -X POST http://localhost:<port>/pots/<potId>/entries/text -H "content-type: application/json" -d '{"text":"hello","capture\_method":"clipboard","captured\_at":<now>}'`



5\) List entries:

\- `curl http://localhost:<port>/pots/<potId>/entries`



6\) Run tests:

\- `pnpm test`



---



\## Git Commit Plan (Phase 2)

1\) `feat(storage): add sqlite connection, pragmas, and migration runner`

2\) `feat(storage): add pots/entries/audit schema migrations`

3\) `feat(api): implement pot CRUD endpoints`

4\) `feat(api): implement text entry endpoints with hashing + provenance`

5\) `test(api): add phase 2 integration tests`

6\) `docs: update architecture + qa + changelog for phase 2`



---



\## Phase 2 Exit Criteria Checklist

\- \[ ] migrations create schema from scratch

\- \[ ] pot CRUD passes integration tests

\- \[ ] text entry CRUD passes integration tests

\- \[ ] hash canonicalization is reproducible and tested

\- \[ ] audit events written for pot + entry creation

\- \[ ] docs updated

\- \[ ] smoke script passes



---



