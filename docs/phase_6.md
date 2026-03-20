````md

\# Phase\_6.md — OpenRouter Integration (Model Registry + Safe AI Call Wrapper)



\## Purpose

Phase 6 adds the core AI plumbing without yet “doing intelligence”:

\- a \*\*model registry\*\* that refreshes the \*\*latest OpenRouter model list\*\* at startup (and on demand)

\- \*\*configurable model selection\*\* per task type (tagging, summarizing, linking later)

\- a \*\*safe AI call wrapper\*\* with:

&nbsp; - low-temp defaults

&nbsp; - strict JSON output mode support

&nbsp; - retries + backoff

&nbsp; - timeouts

&nbsp; - structured logging (no secrets)

\- a \*\*prompt registry\*\* (versioned prompt files) so you can audit outputs later



This phase does \*\*not\*\* implement tagging/linking yet. It just makes AI calls safe, repeatable, and inspectable.



---



\## Definition of Done

Phase 6 is complete only when:



\### ✅ Model list refresh works

\- On app start (API + worker), the latest OpenRouter model list is fetched and cached.

\- A CLI command exists: `pnpm models:refresh`.

\- A diagnostic endpoint exists: `GET /models` returning cached models (no secrets).



\### ✅ User can configure model choice

\- Config exists for:

&nbsp; - default model

&nbsp; - per-task override (e.g., `tagging\_model`, `summary\_model`, `link\_model`)

\- Config is persisted (DB prefs) and validated.



\### ✅ Safe AI wrapper exists

\- A single function handles OpenRouter calls with:

&nbsp; - timeout

&nbsp; - retries + exponential backoff

&nbsp; - low-temp default (0.2)

&nbsp; - max tokens guardrails

&nbsp; - structured logs with request\_id/job\_id

\- Wrapper supports “JSON-only” response mode (best effort + validation).



\### ✅ Prompt registry exists

\- Prompts are stored as files with IDs and versions.

\- Every call stores prompt\_id + prompt\_version in metadata.



\### ✅ Tests \& QA

\- Unit tests for:

&nbsp; - model list caching logic (mocked)

&nbsp; - retry/backoff

&nbsp; - prompt registry resolving correct versions

\- Integration test (mock OpenRouter HTTP) verifies:

&nbsp; - wrapper calls correct endpoint

&nbsp; - respects selected model

&nbsp; - handles failures and retries

\- Smoke script performs a “test call” with a stub or real key.



\### ✅ Docs updated

\- `docs/security.md` updated for API key handling + logging rules.

\- `docs/pipeline.md` updated to reference model config and prompt versioning.

\- `CHANGELOG.md` updated.



---



\## Security Baseline (Phase 6)

\- OpenRouter API key is never logged.

\- API key stored in OS keychain if available, else encrypted config.

\- Requests are TLS (https) only.

\- Allowlist domains if you implement fetch hardening.



---



\## Data Model Additions (Phase 6)



\### 1) `model\_registry` (cached model list)

Table: `model\_registry`

\- `id` (TEXT, primary key; e.g., `"openrouter"`)

\- `fetched\_at` (INTEGER epoch ms)

\- `models\_json` (TEXT)  // raw model list JSON (or normalized fields)

\- `etag` (TEXT, nullable) // if supported

\- `source\_version` (TEXT, nullable) // optional



Index:

\- none needed beyond primary key



\### 2) Extend `user\_prefs` keys

Add capture-independent prefs:

\- `ai.default\_model`

\- `ai.task\_models` (map task\_type -> model\_id)

\- `ai.temperature.default` (default 0.2)

\- `ai.max\_tokens.default` (sane default)

\- `ai.timeout\_ms` (e.g., 30000)

\- `ai.retry.max\_attempts` (e.g., 3)



---



\## OpenRouter Integration Design



\### 1) Provider module (`packages/ai/openrouter`)

Responsibilities:

\- fetch model list

\- make chat/completions calls (depending on OpenRouter API shape you choose)

\- normalize errors into typed errors (timeout, rate\_limit, auth, etc.)



\### 2) Model selection logic

Given a task type (e.g., `tag\_entry` later), select model in this order:

1\) user prefs per-task override

2\) user prefs default model

3\) env default (`OPENROUTER\_DEFAULT\_MODEL`)

4\) hardcoded fallback (document it)



\### 3) Request metadata

Every AI call includes:

\- `model`

\- `task\_type` (even in Phase 6, pass something like `diagnostic`)

\- `prompt\_id` + `prompt\_version`

\- `temperature`, `max\_tokens`

\- `request\_id` and/or `job\_id` (if called by worker)



Store this metadata with the result (Phase 6 can store it only in logs; Phase 7 will store as derived artifacts).



---



\## Prompt Registry (Phase 6)

Create `packages/ai/prompts/`:

\- `diagnostic/`

&nbsp; - `v1.md`

\- future:

&nbsp; - `tag\_entry/v1.md`

&nbsp; - `summarize\_entry/v1.md`

&nbsp; - `link\_pair/v1.md`



Prompt registry rules:

\- Prompt ID is folder name (e.g., `diagnostic`)

\- Version is `vN` file

\- Registry exports:

&nbsp; - `getPrompt(promptId, version)`



---



\## API (Phase 6)



\### A) List cached models

\#### `GET /models`

Returns normalized list:

```json

{

&nbsp; "source": "openrouter",

&nbsp; "fetched\_at": 123,

&nbsp; "count": 999,

&nbsp; "models": \[

&nbsp;   { "id": "provider/model", "name": "...", "context\_length": 12345, "pricing": {...} }

&nbsp; ]

}

````



\### B) Refresh models on demand



\#### `POST /models/refresh`



\* triggers fetch and updates cache

\* returns fetched\_at + count



\### C) Get/set AI prefs



\#### `GET /prefs/ai`



\#### `PUT /prefs/ai`



Body example:



```json

{

&nbsp; "default\_model": "openai/gpt-5",

&nbsp; "task\_models": {

&nbsp;   "tag\_entry": "anthropic/claude-4",

&nbsp;   "summarize\_entry": "openai/gpt-5"

&nbsp; },

&nbsp; "temperature": { "default": 0.2 },

&nbsp; "max\_tokens": { "default": 800 },

&nbsp; "timeout\_ms": 30000,

&nbsp; "retry": { "max\_attempts": 3 }

}

```



Validation:



\* model IDs must exist in cached registry (or allow unknown with warning; choose one).

&nbsp; Recommended:

\* allow unknown but warn + mark “unverified” until next refresh.



\### D) Diagnostic test call (QA)



\#### `POST /ai/test`



Body:



```json

{

&nbsp; "model": "optional override",

&nbsp; "prompt\_version": "v1",

&nbsp; "input": "ping"

}

```



Response includes only safe metadata + model output:



```json

{

&nbsp; "ok": true,

&nbsp; "model": "...",

&nbsp; "latency\_ms": 1234,

&nbsp; "output": "..."

}

```



---



\## Worker/Processing Engine Integration



Even though Phase 6 doesn’t run real AI jobs yet, wire the system so worker can:



\* refresh models at startup (optional)

\* call `aiClient.runTask(...)` for future phases



Add a “placeholder AI job type”:



\* `ai\_diagnostic`

&nbsp; This proves the worker can run a job that calls OpenRouter safely.



---



\## AI Wrapper Behavior (Must-Haves)



\### 1) Timeouts



\* Abort requests after `timeout\_ms`.



\### 2) Retries



Retry only on:



\* transient network errors

\* 429 rate limits (with backoff)

\* 5xx



Do NOT retry on:



\* 401/403 auth failures

\* schema validation failures



\### 3) Backoff



\* exponential backoff with jitter

\* store attempt count and final error reason



\### 4) JSON-only mode (best effort)



When a task requires JSON:



\* prompt instructs JSON output only

\* wrapper attempts to parse JSON

\* if parse fails, treat as recoverable once (optional “repair” pass later, but not in Phase 6)



---



\## Tests (Phase 6)



\### Unit tests



\* model selection order logic

\* prompt registry resolves correct content

\* retry/backoff decisions (which errors retry)



\### Integration tests (mock HTTP)



Use `nock` or undici mock:



\* model list fetch returns sample JSON

\* wrapper performs call to correct endpoint with correct headers

\* verify retries on 429 then success

\* verify no retries on 401



\### Smoke script



`scripts/smoke-phase6.(sh|ps1)`:



1\. refresh models

2\. set ai prefs default model

3\. run `/ai/test` (real key required) OR run with mocked endpoint in dev mode

4\. print model + latency



Exit non-zero if fails.



---



\## QA Steps (Manual)



1\. Set env:



\* `OPENROUTER\_API\_KEY=...`



2\. Run API:



\* `pnpm dev`



3\. Refresh models:



\* `curl -X POST http://localhost:<port>/models/refresh`



4\. List models:



\* `curl http://localhost:<port>/models | head`



5\. Test call:



\* `curl -X POST http://localhost:<port>/ai/test -H "content-type: application/json" -d '{"input":"ping"}'`



---



\## Git Commit Plan (Phase 6)



1\. `feat(ai): add openrouter provider + model registry cache table`

2\. `feat(api): add models list/refresh endpoints`

3\. `feat(prefs): add ai prefs get/put and validation`

4\. `feat(ai): add safe ai wrapper with retries/timeouts + prompt registry`

5\. `test(ai): add mocked integration tests for model fetch and retry`

6\. `docs: update security, pipeline, qa, changelog for phase 6`



---



\## Phase 6 Exit Criteria Checklist



\* \[ ] model list refresh + cache works

\* \[ ] ai prefs persisted and validated

\* \[ ] safe wrapper exists (timeout/retry/backoff/logging)

\* \[ ] prompt registry versioning works

\* \[ ] tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



