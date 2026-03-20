Links — Research Capture \& Intelligence Backend (Backend-First Plan)

0\) The mission



Build a local-first research back end that helps users capture, organize, and connect research artifacts (text, images, docs, sources, notes) into secure “research pots” (a.k.a. vaults/projects/cases), then runs idle-time processing to tag, link, and surface relationships—while keeping hallucinations minimized via low-temp, evidence-first prompting, and auditability via deep logging + reproducible pipelines.



This system must support use cases like:



scientific research



legal case prep



investigative / law enforcement case building



“conspiracy research” (i.e., hypothesis-heavy work where provenance matters)



general knowledge capture



Backend-first now; UI integration later.



1\) Non-negotiable principles

1.1 Evidence-first, provenance always



Every stored item must preserve:



source (URL/file origin/clipboard)



timestamp



context (title, surrounding text if available, capture method)



integrity (hash/signature, where feasible)



audit trail (what processing happened, which model, which prompt version, when)



1.2 Modular by default



Everything is a module:



capture ingestion modules



processing pipeline stages



storage adapters



model provider adapters



MCP tools



Swappable without rewriting core.



1.3 Testability at each feature



Each feature includes:



unit tests



integration tests (DB + API)



“smoke” scripts for quick QA



deterministic fixtures to validate “AI pipeline” structure even if model outputs vary



1.4 “Don’t kill Alex with git”



Any “model performs git actions” must follow a strict preview + explain + verify workflow (see git.md).



2\) Scope boundaries (to keep this sane)

In-scope for backend MVP



secure research pots (create/list/export/import)



capture API (clipboard text, snippet + metadata, images, documents)



storage layer (DB + file store)



processing engine (queue + workers)



OpenRouter model integration



MCP server exposing tools across the system



logging/observability



Chrome extension integration endpoints (even if extension itself is phase-later)



Out-of-scope initially



full polished GUI



complex auth/SSO



multi-user collaboration server (we’ll build export/import first)



“perfect” semantic search UX (backend capability yes, UI later)



3\) Proposed architecture (backend-first)

3.1 Components



Core API Service (Fastify or similar)



REST/JSON endpoints (and optionally websockets for events later)



validates everything via schemas



writes to DB + file store



enqueues processing tasks



Storage Layer



PostgreSQL (recommended) OR SQLite (acceptable for local-only)



a file store for binaries (images/docs) with encryption-at-rest



Processing Engine



job queue (BullMQ/Redis OR local queue abstraction)



worker that performs:



extraction (doc -> text)



tagging/classification



entity extraction



link discovery between entries



relationship graph updates



“idle time” mode to run only when machine is calm



AI Provider Layer



OpenRouter integration, model list refresh at startup



configurable model selection per task type (“tagging model”, “linking model”, etc.)



low-temp defaults



prompt templates versioned + stored



MCP Server



exposes research pot tools, capture tools, query tools, processing tools



used by other AI clients to interact safely



Chrome Extension Bridge



endpoints for right-click “Save selection”, “Save image”, etc.



token-based local auth (not hard-coded)



4\) Technology choices (recommendations)

4.1 Language



TypeScript/Node (matches your existing ecosystem; fast iteration)



Optionally later: Rust worker for heavy parsing, but not at MVP.



4.2 Database



Pick one:



Postgres if you want “solid modern responsive” + future multi-user scaling.



SQLite if you want single-user local simplicity (still solid if schema is good + WAL mode).



Given your “research vault export/share” requirement, Postgres + portable export format is ideal long-term, but SQLite is simpler for “local-first single binary distribution.”

Plan assumes SQLite first, with a clean abstraction so Postgres can be swapped later.



4.3 Encryption



Each research pot can be encrypted using:



master key derived from user secret (Argon2id)



per-pot data key (envelope encryption)



file store encrypted blobs



DB fields that are sensitive can be encrypted at field level (optional; expensive).

Minimum viable: encrypt file store + “export bundles” + secrets. Keep DB local with OS-level protection.



5\) Data model (high level)

5.1 Core entities



Pot: a research project/vault/case



id, name, description, security settings, created\_at



Entry: atomic captured item



id, pot\_id, type (text/image/doc/link/note)



content refs (text in DB; files by hash/path)



source metadata (url, title, author, capture method)



timestamps



Asset: stored binary



id, sha256, size, mime, encrypted\_path, created\_at



Tag: label (user or AI)



id, name, type (user/ai), confidence, provenance



Entity: extracted named entity / concept node



id, label, type, external\_ids (optional)



Link: relationship between entries/entities



src, dst, type (“supports”, “contradicts”, “same\_topic”, “same\_person”)



confidence



evidence pointer (which text span / excerpt caused it)



ProcessingJob: pipeline task record



id, pot\_id, entry\_id (nullable), job\_type, status, model, prompt\_version, started\_at, finished\_at, logs pointer



5.2 Why this structure



Lets you:



track provenance



build a graph



keep AI outputs auditable



export/import a pot cleanly



6\) Feature phases (each testable)

Phase 1 — Repo skeleton + standards (Day 0)



Goal: establish a boring, reliable foundation.



Deliverables:



monorepo layout (or single repo with packages/)



lint/format/test



env handling



logging baseline



docker/dev scripts (optional)



docs/git.md created immediately (see below)



Tests:



CI runs unit tests + lint



“hello world” API + health check



QA:



pnpm test



pnpm lint



pnpm dev + call /health



Phase 2 — Storage layer + schema (Pots + Entries, minimal) (Day 1–2)



Goal: create a pot and store text entries.



Deliverables:



DB migrations



pot CRUD



entry CRUD (text only)



schema validation



“integrity hash” per entry payload



Tests:



create pot, list pots



create entry in pot



fetch entry



ensure entry hash reproducible



QA:



script ./scripts/smoke-db.ts creates pot + entry and prints ids



Phase 3 — Ingestion API (clipboard capture + metadata) (Day 2–3)



Goal: backend endpoints ready for your ctrl+c popup to call.



Endpoints:



POST /pots/:id/entries/text



body: text, title(optional), source\_url(optional), notes(optional), capture\_method



POST /pots/:id/entries/link



url + optional excerpt + optional page title



GET /pots/:id/entries (filterable)



Tests:



validation rejects empty text



stores metadata



pagination works



QA:



curl / httpie commands in /docs/qa.md



Phase 4 — Asset store (images + docs as blobs) (Day 3–5)



Goal: support image/doc ingestion.



Deliverables:



encrypted file store layout:



/data/pots/<potId>/assets/<sha256>.blob



asset registry table



endpoints:



POST /pots/:id/assets (upload)



POST /pots/:id/entries/image (asset ref + metadata)



POST /pots/:id/entries/doc (asset ref + metadata)



hash verification on upload



Tests:



same file upload deduplicates by hash



retrieval returns correct metadata



encryption round-trip works (basic)



QA:



script uploads a sample file and verifies sha256 + DB record



Phase 5 — Processing engine skeleton (queue + jobs table) (Day 5–6)



Goal: pipeline is real, even before AI.



Deliverables:



job creation triggers on entry insert (configurable)



worker that:



takes job



writes status transitions



writes logs



“idle mode” scheduler:



runs only when:



CPU < threshold



user idle (optional signal from OS/UI later)



time window allowed



Tests:



enqueue job on entry create



job transitions: queued -> running -> done



retry policies and dead-letter handling



QA:



pnpm worker runs locally; create entry triggers job



Phase 6 — OpenRouter integration (model list refresh + calls) (Day 6–7)



Goal: model access is stable and configurable.



Deliverables:



provider module:



fetch latest model list at app start



cache to DB/file



user config selects model per task type



“AI call wrapper”:



low-temp default (e.g., 0.2)



max tokens bounded



retries with backoff



logs prompt + response metadata (not raw secrets)



safe prompt template system:



versioned prompt files



prompt id + version stored with job



Tests:



model list fetch mocked + cached



AI wrapper uses configured model



errors are handled and logged



QA:



command pnpm models:refresh prints available models



“test call” endpoint to verify auth



Phase 7 — Tagging + classification (Day 7–9)



Goal: entries get structured tags + summaries with provenance.



Pipeline jobs:



extract\_basic\_metadata (rule-based)



ai\_tag\_entry



ai\_summarize\_entry (evidence-cited where possible)



Rules:



tags store confidence + model + prompt version



“summary” must reference captured content only



do NOT fabricate external facts (strict instruction)



Tests:



tagging inserts tags with provenance



summary stored as derived artifact linked to entry



deterministic test validates schema shape, not exact text



QA:



create entry -> worker produces tags + summary visible via API



Phase 8 — Connection finding (linking) (Day 9–12)



Goal: discover relationships between entries.



Approach (safe + scalable):



Build candidate set using cheap heuristics:



shared pot



time proximity



overlapping entities/tags



similar keywords



Use AI only for:



relationship type classification



confidence scoring



evidence snippet extraction



Outputs:



Link records with:



src, dst, type



confidence



evidence excerpt + offsets



Tests:



candidate generation works



link insertion respects uniqueness constraints



links query returns graph-like view



QA:



add 5 entries about similar topic -> see links appear after idle processing



Phase 9 — Export / import pot securely (Day 12–14)



Goal: sharing pots safely.



Export format:



encrypted bundle (zip/tar)



includes:



DB subset (or JSON export)



assets



manifest with hashes



optional “public share mode” stripping sensitive metadata



Import:



validate manifest + hashes



decrypt



rehydrate DB + assets



Tests:



export then import yields identical counts + hashes



tampered bundle fails



QA:



pnpm pot:export <id>



pnpm pot:import <bundle>



Phase 10 — MCP server (Day 14–16)



Goal: MCP access throughout.



Expose MCP tools like:



list\_pots



create\_pot



capture\_text



capture\_link



search\_entries



get\_entry



export\_pot



run\_processing\_now



get\_processing\_status



Tests:



MCP server starts



each tool validates inputs and returns expected JSON



QA:



sample MCP client script calls tools locally



Phase 11 — Chrome extension integration layer (backend endpoints + auth) (Day 16–18)



Goal: ready for extension work.



Deliverables:



local auth token system (rotatable)



endpoints:



POST /ext/capture/selection



POST /ext/capture/imageByUrl (download \& store if allowed)



POST /ext/capture/pageMeta (url/title)



rate limiting + origin checks



logs tagged source=extension



Tests:



token required



invalid token rejected



stored entries appear in pot



QA:



simulate extension calls via curl



Phase 12 — Ctrl+C popup capture integration readiness (backend side) (parallel)



Goal: your eventual UI popup has a stable contract.



Deliverables:



endpoints optimized for “popup workflow”:



list pots quickly



“last used pot” preference stored



“auto-save mode” toggle stored per user/per pot



event stream optional (SSE) for “processing complete” notifications later



Tests:



preferences persisted



fast pot list



7\) Logging \& observability plan (serious)

7.1 Structured logs



Use JSON logs with fields:



timestamp, level, service, module



pot\_id, entry\_id, job\_id where relevant



request\_id correlation



model name + prompt version for AI calls



error stacks



7.2 Audit log



A dedicated table:



audit\_events



actor (user/system/extension)



action (create\_entry, export\_pot, ai\_tag\_job\_started)



object refs



timestamp



metadata



7.3 Debug “time travel”



Every processing job stores:



input references (entry ids, asset ids)



prompt version



model



output artifact ids

So you can re-run jobs and compare.



8\) Security model (practical, not fantasy)



Secrets stored via OS keychain if possible; fallback encrypted config file.



Per-pot encryption keys derived via envelope encryption.



Export bundles always encrypted.



Extension auth token is local-only and rotatable.



No remote telemetry by default.



9\) QA \& “solo team” tooling

9.1 Commands you will rely on



pnpm test (unit + integration)



pnpm smoke (one-shot end-to-end)



pnpm db:migrate



pnpm worker



pnpm models:refresh



pnpm pot:export



pnpm pot:import



9.2 QA checklist per feature



Each phase adds:



a smoke script



a short /docs/qa.md section with:



how to test manually



expected output



common failure modes



10\) Git workflow protection (must exist day 0)



Create docs/git.md and enforce it. The model must:



explain the plan before commands



show git status and branch before touching anything



never force push unless you explicitly approve



never commit generated secrets



only commit in small, named batches with clear messages



include changelog updates per feature completion



(See docs/git.md template below in this plan.)



11\) Naming: Links / Lynx / Copy (quick direction)



Links: clean, literal, product-ish.



Lynx: vibes, memorable, “hunter of connections.”



Copy: too generic and conflicts with… everything.

Recommendation: Lynx for the engine, Links for the user-facing brand if you want both.



12\) Definition of “done” (backend MVP)



Backend MVP is done when:



you can create pots



capture text/link/image/doc into pots



processing runs idle-time and produces tags + summaries + links



export/import works securely



MCP tools expose the full core workflow



chrome extension endpoints exist and are testable via curl



logging/audit trail is strong enough that you can debug without guessing



Appendix A — docs/git.md (drop-in template)

Git Safety Protocol (Model + Alex)

Principles



No surprises. Commands are proposed first, then executed.



Small commits. One feature batch per commit.



No force pushes unless Alex explicitly requests.



Before any git action



Show:



git status



git branch --show-current



git log --oneline -n 10



State intent:



what will change



which files



what commit message



whether a push/merge is planned



Commit rules



Commit message format:



feat(<area>): ...



fix(<area>): ...



chore: ...



docs: ...



Each commit must include:



relevant tests added/updated



changelog entry (if feature complete)



Push rules



Push only the current branch unless stated otherwise.



Always confirm remote:



git remote -v



git rev-parse --abbrev-ref --symbolic-full-name @{u} (if tracking)



Never push secrets. Use secret scan.



Merge rules



Prefer PR-style merges (even locally) using:



git merge --no-ff



If conflicts exist:



stop, explain, propose resolution steps



Recovery commands (allowed)



git restore --staged <file>



git restore <file>



git reset --soft HEAD~1 (only if last commit is wrong and not pushed)



Forbidden without explicit approval



git push --force



rewriting published history



deleting branches



rebasing shared branches



Appendix B — “low hallucination” AI policy for pipelines



Default temp: 0.2 (configurable)



Always instruct:



“use only the provided content”



“output JSON following schema”



“include evidence excerpt for every link claim”



Never let AI write directly into core truth tables without schema validation + provenance.

