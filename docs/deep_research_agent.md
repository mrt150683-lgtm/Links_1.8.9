You are Claude Code working inside my monorepo. Your job: implement a modular “Deep Research Agent” addon for Links.

You MUST read:
- @docs/plan.md (architecture, principles)
- @docs/rules.md, @docs/pipeline.md, @docs/security.md, @docs/qa.md
- the existing codebase patterns for: pots, entries, artifacts, job queue/worker, settings/prefs, logging, prompt registry, OpenRouter provider wrapper
- @deep-research-main/ (reference implementation; do NOT blindly copy – adapt to our architecture)

Non-negotiables:
- Evidence-first + provenance always. No hallucinated claims saved to DB.
- Modular by default (feature flag / pot toggle). No breaking changes.
- Everything is testable: unit + integration + smoke/QA steps.
- Idempotent jobs: re-runs do not create duplicate artifacts/entries/links.
- Budget caps: time/tokens/sources/cost/entries; must hard-stop cleanly.
- Logging: structured, no secrets. Every run is auditable end-to-end.

Goal (Feature Summary):
Add a “Deep Research Agent” that can run on a schedule (user-defined time) or manual trigger, per selected pot, using a chosen model (OpenRouter task model selection). The agent:
1) Generates a RESEARCH PLAN (approval step) based on a goal/criteria prompt.
2) Runs deep research ITERATIVELY primarily over the POT corpus (local-first “zero-web mode”).
3) Optionally augments with web sources; any external sources must be ingested into the pot as entries (with provenance) and then flow through standard pipelines.
4) Produces a final report artifact, plus delta report vs previous run, plus novelty scoring and alert triggers.
5) Supports checkpoint/resume.
6) Can auto-link findings back into the pot graph (via existing link candidate + classifier pipeline with evidence excerpts).

You must implement Tier 1 + Tier 2:
Tier 1:
- Research Runs as first-class object (persisted)
- Hard budgets (time/tokens/sources/cost/entries)
- Progress streaming to UI (or API polling + progress events)
- Pot-first retrieval (zero-web mode)
- Delta reports (what changed since last run)
- Novelty scoring + alert triggers
Tier 2:
- Checkpoint + Resume
- Research plan approval step
- Auto-linking back into graph
- Optional web-augmentation that feeds back into pot (ingest sources)

Deliverables:
A) A new docs plan: docs/deep_research_agent.md describing architecture, data model, job types, endpoints, UI changes, tests, risks.
B) Implementation across apps/api + apps/worker (+ UI packages/apps if they exist) with migrations, schemas, tests.
C) Update docs: docs/architecture.md, docs/pipeline.md, docs/security.md, docs/qa.md, CHANGELOG.md.
D) A smoke script / QA instructions to validate end-to-end.

IMPORTANT WORKFLOW:
Step 1 (Plan-only): Output a detailed implementation plan including:
- What files will be created/modified
- DB schema/migrations
- Job types and flow
- API endpoints and payload schemas
- UI changes
- Test plan
- Risks + mitigations
STOP after plan and wait for my approval.
Step 2 (Implementation): Only after approval, implement in small commits, keeping tests green.

-------------------------------------------------------------------------------
FEATURE DESIGN REQUIREMENTS (be precise)

1) Core Concepts / Entities
Create “Research Run” as first-class persistent object.
- Each run belongs to a pot.
- Stores: goal prompt, config (breadth/depth/budgets), selected model, created_by, created_at, status, started_at/finished_at, previous_run_id (for delta), and “plan approved?” state.
- Stores audit manifest: which entries were read (entry ids + sha256), which sources were ingested (urls + hashes), which prompts/versions were used.

Statuses (minimum):
- draft (created, not planned yet)
- planning (generating plan)
- awaiting_approval (plan generated, waiting)
- queued (approved and queued)
- running
- paused (checkpoint exists; resumable)
- done
- failed
- cancelled

2) Budgets / Guardrails (hard stops)
Implement a budget system enforced by worker:
- max_wall_time_ms
- max_model_tokens (approx; use provider usage if available)
- max_cost_cents (if you have cost estimates; else implement “soft cost” from token usage + model pricing if present in model registry)
- max_entries_read
- max_web_pages_fetched
- max_total_sources
- max_depth, max_breadth
- max_concurrency (web + AI)
When budget is exceeded:
- stop gracefully
- mark run as paused or done-with-budget-hit
- write a “partial report” artifact plus an “open loops” section indicating what was not completed

3) Progress Streaming
Expose progress updates for UI:
- depth/breadth progress
- current step (“planning”, “retrieving pot entries”, “processing results”, “writing report”, etc.)
- counts (entries_read, pages_fetched, queries_completed, etc.)
Implement as ONE:
A) persisted progress in DB (polling) + optional SSE endpoint; OR
B) events table + UI polling
Do not require websockets unless the app already uses them.

4) Pot-First Retrieval (zero-web mode)
Adapt deep-research algorithm to operate over local pot corpus:
- Replace “SERP search” with “local retrieval”:
  - use existing DB search (FTS/keyword) + existing artifacts (summaries/tags/entities)
  - select top-K relevant entries per subquery
  - build “contents” from these entries: snippet + provenance + stable evidence pointers
- Ensure prompt injection safety: the pot content may contain malicious instructions; the model must treat pot text as data only.
- For each local retrieval batch, generate:
  - learnings[] (information-dense bullets with entities/dates/numbers)
  - followUpQuestions[] (next directions)
- Keep evidence pointers: each learning should reference which entry/offset(s) support it, OR at minimum “source entry ids used”.

5) Optional Web Augmentation (feeds into pot)
If enabled at pot/run level:
- Use safe web fetch/search approach (reuse existing ingestion pipeline if present; otherwise implement minimal safe HTTP fetch w/ allowlist/denylist, timeouts, size caps, content-type restrictions).
- Any external page must be ingested into pot as an Entry (type “web_page” or “link”) with:
  - url, title, fetched_at, capture_method="deep_research"
  - raw content stored as artifact or entry text
  - sha256 / integrity hash
- After ingestion, enqueue normal pipeline jobs (extract/summarize/entities/tags) using existing task models.

6) Research Plan Approval Step
Before executing full run:
- Generate a plan artifact (structured JSON + readable markdown) that includes:
  - refined goal
  - assumptions
  - sub-questions
  - proposed breadth/depth
  - whether web augmentation will be used
  - what data will be read (pot-only vs web)
  - expected costs/time (estimate)
- Set run to awaiting_approval.
- Add API + UI to approve plan, then enqueue execution jobs.

7) Checkpoint + Resume
Persist checkpoint state during execution:
- At minimum store:
  - current recursion state (depth/breadth), pending subqueries, accumulated learnings, visited source ids/urls, entries read, and budget usage.
- Resume continues without repeating finished work.
- If a run is interrupted (crash), it can be resumed safely.

8) Delta Reports (what changed)
After a run completes (or pauses with partial report), compute delta vs previous successful run for that pot:
- Compare:
  - learnings (new/removed/changed)
  - new sources
  - changed conclusions (LLM-assisted diff is fine, but must be deterministic-ish)
- Store delta artifact:
  - short summary
  - “new since last run” bullets
  - “changed/contradicted” bullets
  - “still unresolved” bullets

9) Novelty Scoring + Alerts
Compute novelty score (0..1) for the run relative to:
- previous run’s learnings (primary)
- the pot’s existing summaries/entities (secondary)
Use a strict JSON schema for novelty output:
- novelty_score
- top_new_findings[] with evidence pointers
- contradictions[] (claims that conflict with prior high-confidence info)
Alert triggers:
- per pot settings: novelty_threshold, contradiction_threshold, optional keywords/entities watchlist
When triggered:
- create a notification record/event consumable by UI
- include short message + link to run + top reasons
(Do not send external notifications unless app already supports it.)

10) Auto-linking back into pot graph
Translate key learnings into link candidates:
- For each new finding, find supporting entries and related entries
- Create link candidates using existing pipeline conventions:
  - evidence excerpts + offsets
  - link_type suggestions (supports/contradicts/references/same_topic/etc.)
- Enqueue existing classify_link_candidate jobs (AI constrained, evidence-first)
Must prevent graph spam:
- thresholding + max_links_per_run
- dedupe (do not create duplicates)

11) Scheduling (user-defined time per pot)
Implement scheduled runs:
- user selects pot, sets schedule time (and timezone handling), enables deep research agent
- schedule triggers planning+approval optionally, or planning auto-approve (config)
- Must be idle-time friendly (reuse existing idle mode / throttle)
Implementation approach:
- Prefer a simple worker-side scheduler that checks “due runs” every minute (DB-driven) rather than adding heavy infra.
- Store schedule in DB (per pot settings).

12) Model Selection
Integrate with existing OpenRouter model registry and per-task model selection:
- Add a new task type key (e.g., deep_research_model)
- Support separate models for: planning, extraction/learnings, final report, novelty/delta (optional; default to deep_research_model)
Use low temp defaults (0.2) unless overridden.

13) Prompt Registry + Schemas
All AI calls must:
- use versioned prompt IDs stored in prompt files
- validate JSON outputs with Zod schemas
- store prompt_id + version + model_id + temp + timestamp in provenance

14) Security / Safety
- Prompt injection defense: pot contents and web pages are untrusted.
- Web augmentation must mitigate SSRF, huge downloads, unsafe content-types.
- Do not store secrets in DB/logs.
- Respect pot retention/forget controls if they exist.

-------------------------------------------------------------------------------
IMPLEMENTATION GUIDANCE (how to structure code)

- Prefer creating a new package: packages/deep-research (or similar) that exports:
  - generateResearchPlan()
  - executeDeepResearch()
  - computeDelta()
  - computeNovelty()
  - extractLinkCandidatesFromFindings()
These functions should be adapter-driven:
  - CorpusProvider interface: query -> getContents()
  - SourceIngestor interface: url/content -> create entry + enqueue pipeline
  - ProgressReporter interface: updateProgress()
So the worker can run pot-only or pot+web by swapping adapters.

- Deep-research-main reference:
  - Use its algorithm ideas: generateSerpQueries, processResult -> learnings + follow-ups, recursive depth/breadth, progress callback, concurrency limiting.
  - Replace Firecrawl search with PotCorpusProvider and optional WebSearchProvider.
  - Ensure output includes evidence pointers and is schema validated.

-------------------------------------------------------------------------------
API + UI REQUIREMENTS

API endpoints (or equivalent):
- POST /pots/:potId/research-runs
  body: { goalPrompt: string, config?: {...}, schedule?: {...}, autoApprovePlan?: boolean }
- GET /pots/:potId/research-runs (list)
- GET /research-runs/:runId (details incl progress + artifacts)
- POST /research-runs/:runId/approve-plan
- POST /research-runs/:runId/cancel
- POST /research-runs/:runId/resume

UI:
- In pot page, when feature enabled:
  - “Deep Research Agent” section with:
    - enable toggle
    - schedule time + run now button
    - model selection (dropdown of OpenRouter models like other settings)
    - prompt input (goal + criteria)
    - run status + progress
    - plan approval modal/view
    - link to latest report/delta
Keep UI changes minimal and consistent with existing components.

-------------------------------------------------------------------------------
TESTING REQUIREMENTS

Add tests at minimum:
Unit:
- budget enforcement (exceed time/tokens/entries/pages)
- checkpoint save/load
- delta computation (mock learnings sets)
- novelty scoring schema validation (mock AI response)
Integration:
- Create pot with a few entries; run pot-only deep research with mocked AI:
  - generates plan -> awaiting approval
  - approve -> run -> produces report artifact
  - second run -> produces delta artifact
  - novelty triggers notification
- Optional web ingest path: mock fetch/search and verify new entries created and pipeline jobs enqueued
Smoke/QA:
- Add a script or documented steps to run a small demo pot end-to-end.

-------------------------------------------------------------------------------
OUTPUT FORMAT RULES

For the PLAN step:
- Provide a structured plan with numbered steps and exact files to touch.
- Include DB schema and migrations in detail.
- Include endpoint specs and Zod schemas to add.
- Include job types to add to pipeline registry and worker.
- Include risks + mitigations.
STOP and wait for approval.

For the IMPLEMENTATION step (after approval):
- Implement in small, reviewable commits.
- After each commit: summarize what changed + how to run tests.
- Always keep tests passing.

Start now with Step 1: produce the plan only.