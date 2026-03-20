\# Project Rules (Links / Lynx / Copy)



These rules apply to \*\*humans and AI assistants\*\* working on this repo. The goal is: \*\*reliable backend-first development\*\*, strong security, strong provenance, minimal hallucinations, and zero “git chaos”.



---



\## 1) Golden rules

1\. \*\*No surprises.\*\* Explain what you will do before you do it.

2\. \*\*Evidence-first.\*\* Never invent facts about stored content, sources, or links.

3\. \*\*Modular by default.\*\* New capabilities ship as modules with clear boundaries.

4\. \*\*Every feature must be testable.\*\* No “trust me bro”.

5\. \*\*Security is not optional.\*\* If a feature touches storage, export/import, model calls, or extension endpoints: update `security.md`.

6\. \*\*Logs or it didn’t happen.\*\* If it’s worth doing, it’s worth logging (without leaking secrets).



---



\## 2) Repo conventions

\- `apps/api` — HTTP API service

\- `apps/worker` — background processor / job runner

\- `apps/mcp` — MCP server

\- `packages/core` — shared domain + schemas

\- `packages/storage` — DB + file store adapters

\- `packages/ai` — OpenRouter integration + prompts

\- `packages/logging` — structured logging helpers

\- `docs/` — living documentation



\### Naming conventions

\- Domain objects: `Pot`, `Entry`, `Asset`, `Tag`, `Entity`, `Link`, `ProcessingJob`

\- Job types: `extract\_text`, `tag\_entry`, `summarize\_entry`, `link\_discovery`, etc.

\- Artifacts: `derived\_summary`, `derived\_tags`, `derived\_entities`, `derived\_links`



---



\## 2.1) Service management

To avoid confusion with multiple `pnpm dev` processes, use the service management scripts:

\*\*Start all services (API + Worker):\*\*
```bash
bash scripts/start.sh
```

\*\*Check service status:\*\*
```bash
bash scripts/status.sh
```

\*\*Stop all services:\*\*
```bash
bash scripts/stop.sh
```

\*\*Important for AI assistants:\*\*
- At the end of conversations, run `bash scripts/stop.sh` to clean up background processes
- Use `bash scripts/status.sh` to check what's running before starting new processes
- Logs are in `.pids/api.log` and `.pids/worker.log`
- PID files are in `.pids/` directory (git-ignored)



---



\## 3) AI development rules (strict)

\### 3.1 Plan-before-change

Before any code change that is more than a tiny fix, the assistant must output:

\- the intent

\- files to be created/modified

\- tests to be added/updated

\- a short risk list (security / data loss / migration risk)



\### 3.2 No silent edits

\- Never “just do it” with wide refactors.

\- Always show \*\*what will be changed\*\* and \*\*why\*\*.



\### 3.3 Schema-first design

\- Every endpoint payload and AI output must have a schema (Zod/JSON Schema).

\- Store AI outputs only after schema validation.



\### 3.4 Prompting discipline

All AI pipeline prompts must:

\- include a versioned prompt ID

\- instruct model: “use only provided content”

\- output strictly valid JSON per schema

\- include evidence excerpt for claims (especially links)



\### 3.5 Determinism for tests

\- Tests validate \*\*shapes and invariants\*\*, not exact AI text.

\- Use fixtures and mocks for model calls.



---



\## 4) Feature acceptance criteria (Definition of Done)

A feature is “done” only when:

\- ✅ Unit tests exist

\- ✅ Integration test exists (DB + API if relevant)

\- ✅ Smoke script exists OR manual QA steps added to `docs/qa.md`

\- ✅ Logging added (request\_id + relevant ids)

\- ✅ Changelog updated (`CHANGELOG.md`)

\- ✅ Security considerations updated (`docs/security.md`) if applicable



---



\## 5) Data integrity \& provenance rules

Every captured entry must preserve:

\- capture method (`clipboard`, `extension`, `upload`, etc.)

\- timestamp

\- source metadata (URL/title where available)

\- integrity hash (sha256 of canonical content)

\- audit event(s)



No exceptions. If you can’t store provenance, you can’t store the data.



---



\## 6) Idle-time processing rules

\- Idle jobs must be throttled and stoppable.

\- Default “low hallucination” settings:

&nbsp; - temp 0.2 (configurable)

&nbsp; - strict JSON output

&nbsp; - evidence excerpts required for link claims

\- Processing must be idempotent: re-running should not create duplicates.



---



\## 7) Forbidden actions (unless Alex explicitly asks)

\- Force push

\- Delete branches

\- Rewrite published history

\- Commit secrets

\- Introduce new dependencies without explaining why and impact



---



\## 8) Documentation rules

\- Any new module requires a short section in `docs/architecture.md`

\- Any new API route requires update to `docs/api.md` (or OpenAPI if you generate it)

\- Any new job type requires update to `docs/pipeline.md`



---



