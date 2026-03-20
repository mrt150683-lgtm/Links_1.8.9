````md

\# Phase\_10.md — MCP Server (Tool Surface Across the System)



\## Purpose

Phase 10 adds \*\*MCP access throughout\*\* by introducing a dedicated MCP server that exposes the backend as a set of safe, well-scoped tools:

\- create/list pots

\- capture text/link (later: images/docs via assets)

\- search/query entries (basic)

\- fetch artifacts (tags/entities/summary)

\- trigger processing (manual QA)

\- export/import pot (Phase 9)



This makes the system “agent-ready” while keeping security and provenance intact.



---



\## Definition of Done

Phase 10 is complete only when:



\### ✅ MCP server runs locally

\- `pnpm mcp` starts the MCP server.

\- It binds to localhost by default.

\- It can call into the same storage and services as the API/worker.



\### ✅ Core tools implemented

The MCP server exposes tools that cover the core workflow:

\- pot management

\- capture text/link

\- entry retrieval + listing

\- artifacts retrieval

\- processing triggers

\- export/import triggers



\### ✅ Inputs/outputs are schema validated

\- Every tool has a strict JSON schema for arguments.

\- Every tool returns a consistent JSON result.

\- Errors are structured (never raw stack traces).



\### ✅ Security controls

\- Local-only by default.

\- Optional token auth (recommended) for external clients.

\- No secret leakage.



\### ✅ Tests \& QA

\- Tool “smoke” tests exist (script calls a subset of tools).

\- Integration tests validate at least:

&nbsp; - create pot

&nbsp; - capture text

&nbsp; - fetch entry

&nbsp; - fetch artifacts (if Phase 7 done)

&nbsp; - export/import (if Phase 9 done)



\### ✅ Docs updated

\- `docs/architecture.md` updated (MCP component)

\- `docs/qa.md` updated (how to run MCP + example calls)

\- `CHANGELOG.md` updated



---



\## Architecture

\### Components in play

\- API: HTTP routes (human/UI/extension)

\- Worker: jobs and processing

\- MCP: tool surface (agents/LLMs)



MCP server must reuse:

\- `packages/storage`

\- `packages/ai` (indirectly via processing triggers)

\- `packages/core` schemas



---



\## MCP Server Structure

`apps/mcp/`

\- `src/server.ts` — MCP boot

\- `src/tools/` — one file per tool group

\- `src/auth/` — optional token auth

\- `src/schemas/` — tool arg/result schemas (or import from `packages/core`)



---



\## Tool Catalog (Phase 10)



\### A) Pots

\#### Tool: `pots.list`

Args:

```json

{ "limit": 20, "offset": 0, "sort": "recent" }

````



Returns:



```json

{ "pots": \[ { "id":"...", "name":"...", "last\_used\_at": 123 } ] }

```



\#### Tool: `pots.create`



Args:



```json

{ "name": "Case A", "description": "..." }

```



Returns pot object.



\#### Tool: `pots.get`



Args:



```json

{ "pot\_id": "..." }

```



\#### Tool: `pots.delete`



Args:



```json

{ "pot\_id": "..." }

```



---



\### B) Capture



\#### Tool: `capture.text`



Args:



```json

{

&nbsp; "pot\_id": "...",

&nbsp; "text": "...",

&nbsp; "client\_capture\_id": "optional",

&nbsp; "capture\_method": "clipboard",

&nbsp; "captured\_at": 123,

&nbsp; "source\_url": "optional",

&nbsp; "source\_title": "optional",

&nbsp; "notes": "optional",

&nbsp; "source\_app": "optional",

&nbsp; "source\_context": { "optional": "json" }

}

```



Returns:



```json

{ "created": true, "deduped": false, "entry": { ... } }

```



\#### Tool: `capture.link` (optional if implemented)



Args:



```json

{

&nbsp; "pot\_id": "...",

&nbsp; "url": "https://...",

&nbsp; "excerpt": "optional",

&nbsp; "capture\_method": "clipboard",

&nbsp; "captured\_at": 123

}

```



---



\### C) Entries



\#### Tool: `entries.list`



Args:



```json

{ "pot\_id": "...", "limit": 50, "offset": 0 }

```



\#### Tool: `entries.get`



Args:



```json

{ "entry\_id": "..." }

```



---



\### D) Artifacts (Phase 7+)



\#### Tool: `artifacts.list\_for\_entry`



Args:



```json

{ "entry\_id": "..." }

```



\#### Tool: `artifacts.get\_latest`



Args:



```json

{ "entry\_id": "...", "type": "tags|entities|summary" }

```



---



\### E) Processing control (Phase 5+)



\#### Tool: `processing.enqueue`



Args:



```json

{ "job\_type": "tag\_entry", "pot\_id": "...", "entry\_id": "..." }

```



\#### Tool: `processing.run\_now`



Args:



```json

{ "minutes": 5 }

```



---



\### F) Export/Import (Phase 9+)



\#### Tool: `pots.export`



Args:



```json

{ "pot\_id": "...", "mode": "private|public" }

```



\#### Tool: `pots.import`



Args:



```json

{ "bundle\_path": "...", "passphrase": "..." }

```



---



\## Schema Validation Rules



\* Tool argument schemas must reject unknown fields (strict).

\* Tool result schemas must be consistent and versionable.

\* Use the same Zod types as API where possible to prevent drift.



---



\## Error Model (MCP)



All errors returned as:



```json

{

&nbsp; "ok": false,

&nbsp; "error": {

&nbsp;   "code": "NOT\_FOUND|VALIDATION\_ERROR|UNAUTHORIZED|INTERNAL",

&nbsp;   "message": "human readable",

&nbsp;   "details": { "optional": "json" }

&nbsp; }

}

```



No raw stack traces in responses.

Stack traces only in logs (sanitized).



---



\## Security (Phase 10)



\### Default: local-only



\* Bind to `127.0.0.1`

\* No public exposure



\### Optional: token auth (recommended)



\* Store token in local prefs or config

\* Require token in MCP client handshake or per call (implementation dependent)



\### Logging



\* Log tool name, request\_id, pot/entry ids, timing

\* Never log passphrases, API keys, decrypted bundle contents



Update `docs/security.md` with MCP access notes.



---



\## Tests (Phase 10)



\### Unit tests



\* tool schema validation

\* error mapping



\### Integration tests (required)



\* start MCP server in test mode

\* call tools:



&nbsp; 1. `pots.create`

&nbsp; 2. `capture.text`

&nbsp; 3. `entries.get`

&nbsp; 4. (if available) `artifacts.get\_latest`

\* verify outputs match schemas



\### Smoke script



`scripts/smoke-phase10.(sh|ps1)`:



\* starts MCP server

\* calls `pots.create`, `capture.text`, `entries.list`

\* prints results

\* exits non-zero on failure



---



\## QA Steps (Manual)



1\. Run MCP server:



\* `pnpm mcp`



2\. Use a simple MCP client script:



\* `pnpm mcp:smoke` (provide this)



3\. Confirm it can:



\* create pot

\* capture entry

\* list entries



---



\## Git Commit Plan (Phase 10)



1\. `feat(mcp): add mcp server skeleton and local-only binding`

2\. `feat(mcp): implement pots and capture tools with schemas`

3\. `feat(mcp): implement entries and artifacts tools`

4\. `feat(mcp): implement processing and export/import tools`

5\. `test(mcp): add integration tests and smoke script`

6\. `docs: update architecture, qa, changelog for phase 10`



---



\## Phase 10 Exit Criteria Checklist



\* \[ ] MCP server runs locally

\* \[ ] core tools implemented and schema validated

\* \[ ] structured errors returned

\* \[ ] no secrets leak via logs/tool responses

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



