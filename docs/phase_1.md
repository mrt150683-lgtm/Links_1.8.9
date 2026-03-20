```md

\# Phase\_1.md — Repo Skeleton + Standards (Backend-First Foundation)



\## Purpose

Phase 1 creates a \*\*boring, stable, testable\*\* foundation for the Links/Lynx/Copy backend so every later feature can be added without chaos. This phase must deliver:

\- a working API “hello world”

\- logging baseline

\- schema validation baseline

\- test + lint pipelines

\- docs scaffolding (rules/git/security + core architecture docs)

\- a safe git workflow from day zero



No database, no AI, no queue yet. Just the bones done properly.



---



\## Definition of Done

Phase 1 is complete only when all of the following are true:



\### ✅ Runtime

\- `pnpm dev` starts the API and returns `200 OK` on `/health`.

\- API logs are structured JSON and include a request correlation id.



\### ✅ Quality gates

\- `pnpm lint` passes.

\- `pnpm test` passes.

\- CI config exists (GitHub Actions) running lint + tests on PR/push.



\### ✅ Docs exist

\- `docs/rules.md`

\- `docs/git.md`

\- `docs/security.md`

\- `docs/architecture.md`

\- `docs/logging.md`

\- `docs/qa.md`

\- `docs/pipeline.md` (skeleton, no jobs yet)



\### ✅ Git safety rails

\- Default branch protection assumptions written in `docs/git.md`.

\- “Forbidden commands” list present (force push, rewriting history, etc.).



---



\## Repo Layout (proposed)

Use a small monorepo to keep services separated while sharing core packages.



```



/

apps/

api/            # HTTP service (Fastify)

worker/         # background runner (placeholder in Phase 1)

mcp/            # MCP server (placeholder in Phase 1)

packages/

core/           # domain types, zod schemas, shared utils

logging/        # logger + request-id middleware

config/         # env loading + typed config

docs/

...             # rules/git/security/etc

scripts/

smoke-api.sh    # quick health check script

.github/

workflows/

ci.yml

package.json

pnpm-workspace.yaml

tsconfig.base.json

eslint.config.\*   # or .eslintrc.\*

prettier.config.\*



```



\*\*Phase 1 builds only `apps/api` + the shared packages.\*\* Worker/MCP are placeholders with a README.



---



\## Tooling Decisions (Phase 1)

\### Language \& runtime

\- Node.js + TypeScript

\- Package manager: `pnpm`

\- HTTP: Fastify



\### Validation

\- Zod in `packages/core` for request/response schemas

\- Fastify hooks validate input + output (where feasible)



\### Logging

\- Structured JSON logging via `pino`

\- Request ID middleware (generate if missing)

\- Logs include: `request\_id`, `method`, `url`, `status`, `ms`



\### Testing

\- `vitest` for unit tests

\- `supertest` (or Fastify inject) for API route tests



\### Lint/format

\- ESLint + TypeScript rules

\- Prettier

\- Consistent import ordering (optional, but recommended)



---



\## Deliverables (Concrete Task List)



\### 1) Workspace \& dependencies

\- Create monorepo structure

\- Configure pnpm workspace

\- Shared tsconfig base

\- Shared eslint/prettier config

\- Add scripts in root:

&nbsp; - `dev` (runs api dev server)

&nbsp; - `test` (runs all tests)

&nbsp; - `lint`

&nbsp; - `format`



\*\*Acceptance checks\*\*

\- `pnpm -r test` works (recursive)

\- `pnpm -r lint` works



---



\### 2) `packages/config` (typed config loader)

Purpose: centralized env handling.



Deliver:

\- Zod schema for environment variables

\- Loads from `.env` for local dev (dotenv)

\- Exposes a `getConfig()` function



Rules:

\- No secrets committed

\- `.env.example` present



\*\*Tests\*\*

\- config loader rejects missing required vars

\- config loader uses defaults where allowed



---



\### 3) `packages/logging`

Purpose: consistent logs across services.



Deliver:

\- `createLogger()` returning a `pino` instance

\- `requestId` Fastify plugin:

&nbsp; - sets `request\_id` on request + response header

&nbsp; - binds logger child with request\_id



\*\*Tests\*\*

\- unit test: request id generated when missing

\- API test: response contains `x-request-id`



---



\### 4) `packages/core` (schemas + base types)

Purpose: define shared “contract” types.



Deliver:

\- `HealthResponse` schema

\- `ErrorResponse` schema

\- shared error helper: `toPublicError()`



\*\*Tests\*\*

\- schema validation passes for expected payload



---



\### 5) `apps/api` — minimal API skeleton

Deliver:

\- Fastify server

\- registers logging + request id plugins

\- routes:

&nbsp; - `GET /health` returns `{ ok: true, service: "api", version, time }`

&nbsp; - `GET /` returns simple service info



Behavior:

\- structured logs for each request

\- consistent error handling:

&nbsp; - validation errors -> 400 with `ErrorResponse`

&nbsp; - unknown -> 500 with `ErrorResponse`



\*\*Tests\*\*

\- `GET /health` returns 200 + correct schema

\- invalid route returns 404 with consistent JSON (optional)

\- request id header exists



---



\### 6) CI workflow

Deliver `.github/workflows/ci.yml`:

\- install pnpm

\- install deps

\- run lint

\- run tests



\*\*Acceptance\*\*

\- CI runs on push and pull\_request



---



\### 7) Docs (phase-aligned)

Deliver baseline docs (you already requested them; phase 1 makes them “official” in-repo):

\- `docs/rules.md`

\- `docs/git.md`

\- `docs/security.md`

\- `docs/architecture.md` (phase 1 version)

\- `docs/logging.md` (phase 1 version)

\- `docs/qa.md` (phase 1: health check instructions)

\- `docs/pipeline.md` (placeholder skeleton)



---



\### 8) Smoke script

Deliver `scripts/smoke-api.sh` (or `.ps1` if you prefer Windows-first):

\- starts API (or assumes running)

\- curls `/health`

\- fails if not 200 or missing fields



\*\*Acceptance\*\*

\- one command verifies the API is alive



---



\## QA Steps (Manual)

1\) Install:

\- `pnpm i`



2\) Run:

\- `pnpm dev`



3\) Verify:

\- open browser or curl:

&nbsp; - `GET http://localhost:<port>/health`

\- confirm:

&nbsp; - JSON body

&nbsp; - header `x-request-id`

&nbsp; - logs printed as JSON



4\) Run gates:

\- `pnpm lint`

\- `pnpm test`



---



\## Git Commit Plan (Phase 1)

Commit in small chunks; each commit must pass tests.



1\) `chore: init monorepo workspace and tooling`

2\) `feat(logging): add structured logger and request id plugin`

3\) `feat(api): add health endpoint and error handling`

4\) `chore(ci): add github actions for lint and tests`

5\) `docs: add project rules, git protocol, security model, qa`



---



\## Phase 1 Exit Criteria Checklist

\- \[ ] API runs and returns /health

\- \[ ] Lint + tests green locally

\- \[ ] CI green

\- \[ ] Docs present in repo

\- \[ ] Smoke script works

\- \[ ] No secrets committed, `.env.example` present



---



\## Notes

Phase 1 intentionally avoids DB/queue/AI so you don’t bury foundational mistakes under “features”. Phase 2 starts storage/migrations once this foundation is stable.

```



